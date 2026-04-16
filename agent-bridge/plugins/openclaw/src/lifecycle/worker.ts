// worker.ts — Poll loop: fetch inbox → execute → ACK delivery.
// Task source changed from pullTask (queue) to pollInbox (inbox events).
// Auth changed from integrationSecret to JWT bearer token.

import {
  archiveInboxDelivery,
  fetchCurrentMember,
  getConfig,
  getSemanticSessionsDir,
  pollInbox,
  postChannelMessage,
} from '../openclaw/bridge'
import { SemanticOrchestrator } from '../semantic/orchestrator'
import { KnotworkMcpTransport } from '../transport/knotwork-mcp-transport'
import { KnotworkRestTransport } from '../transport/knotwork-rest-transport'
import { OpenClawThinkingRuntime } from '../transport/openclaw-thinking-runtime'
import { isAuthError } from './auth'
import { MAX_RECENT_TASKS } from '../state/persist'
import type { TaskLogger } from '../state/tasklog'
import type {
  ExecutionTask,
  InboxEvent,
  OpenClawApi,
  PluginState,
  RecentTask,
  RunningTaskInfo,
  TaskResult,
} from '../types'

const DEFAULT_AUTHOR_NAME = 'Knotwork Agent'

function isChannelNotifiableFailure(error: string): boolean {
  return (
    /OAuth token refresh failed/i.test(error) ||
    /FailoverError/i.test(error) ||
    /subagent\.run failed/i.test(error) ||
    /api\.runtime\.subagent/i.test(error)
  )
}

function buildChannelFailureMessage(error: string): string {
  if (/OAuth token refresh failed/i.test(error) || /openai-codex/i.test(error)) {
    return [
      `I could not start this task because the OpenClaw model provider authentication failed.`,
      ``,
      `Problem: \`openai-codex\` OAuth token refresh failed.`,
      `Action needed: re-authenticate that provider in OpenClaw, then retry the run or send the message again.`,
      ``,
      `No crawl/tool work was executed before this failure.`,
    ].join('\n')
  }

  return [
    `I could not start this task because the OpenClaw runtime failed before any Knotwork action was taken.`,
    ``,
    `Error: ${error.slice(0, 300)}`,
  ].join('\n')
}

async function resolveAuthorName(
  baseUrl: string,
  workspaceId: string,
  jwt: string,
): Promise<string> {
  try {
    const member = await fetchCurrentMember(baseUrl, workspaceId, jwt)
    const name = String(member.name ?? '').trim()
    if (name) return name
  } catch {
    // Fall back to the generic label if member resolution is unavailable.
  }
  return DEFAULT_AUTHOR_NAME
}

export type WorkerCtx = {
  state: PluginState
  api: OpenClawApi
  log: (msg: string) => void
  rememberError: (err: unknown) => string
  persistSnapshot: () => Promise<void>
  resetAuth: () => Promise<void>
  recoverAuth: (reason: string) => Promise<boolean>
  taskLog: TaskLogger
}

/** Minimal credentials context for running a pre-claimed task without full PluginState. */
export type TaskCredentials = {
  pluginInstanceId: string
  jwt: string
  workspaceId: string
  knotworkUrl: string
  taskLogPath?: string
}

export function upsertRecentTask(state: PluginState, persistFn: () => void, task: RecentTask): void {
  const rest = state.recentTasks.filter((item) => item.taskId !== task.taskId)
  state.recentTasks = [task, ...rest].slice(0, MAX_RECENT_TASKS)
  persistFn()
}

export function currentRecentTask(
  state: PluginState, task: ExecutionTask, taskId: string, startedAt: string,
): RecentTask {
  const existing = state.recentTasks.find((item) => item.taskId === taskId)
  return {
    taskId,
    nodeId: task.node_id ? String(task.node_id) : existing?.nodeId ?? null,
    runId: task.run_id ? String(task.run_id) : existing?.runId ?? null,
    sessionName: task.session_name ? String(task.session_name) : existing?.sessionName ?? null,
    status: existing?.status ?? 'claimed',
    startedAt: existing?.startedAt ?? startedAt,
    finishedAt: existing?.finishedAt ?? null,
    error: existing?.error ?? null,
  }
}

/** Add or update the running task in state.runningTasks. */
export function addRunningTask(state: PluginState, info: RunningTaskInfo): void {
  state.runningTasks = [...state.runningTasks.filter((t) => t.taskId !== info.taskId), info]
  // Keep legacy field in sync for backward compat.
  state.runningTaskId = info.taskId
}

/** Remove a completed/failed task from state.runningTasks. */
export function removeRunningTask(state: PluginState, taskId: string): void {
  state.runningTasks = state.runningTasks.filter((t) => t.taskId !== taskId)
  if (state.runningTaskId === taskId) {
    state.runningTaskId = state.runningTasks[0]?.taskId ?? null
  }
}

/**
 * Convert an InboxEvent to an ExecutionTask.
 * The agent's guide (system prompt) tells it what to do per event type.
 * This user prompt provides the structured event details.
 */
export function inboxEventToTask(event: InboxEvent, _guideContent: string | null): ExecutionTask {
  return {
    task_id: event.id,
    channel_id: event.channel_id ?? undefined,
    session_name: event.channel_id ? `channel-${event.channel_id}` : `inbox-${event.item_type}-${event.id.slice(-8)}`,
    trigger: {
      type: event.item_type,
      delivery_id: event.delivery_id,
      channel_id: event.channel_id,
      run_id: event.run_id,
      escalation_id: event.escalation_id,
      proposal_id: event.proposal_id,
      message_id: event.message_id ?? null,
      asset_type: event.asset_type ?? null,
      asset_id: event.asset_id ?? null,
      asset_path: event.asset_path ?? null,
      title: event.title,
      subtitle: event.subtitle,
    },
  }
}

/**
 * Execute a single inbox event as an agent task.
 * After execution (success or failure), ACKs the delivery_id so the event is
 * marked read and not re-delivered.
 */
export async function runClaimedTask(ctx: WorkerCtx, task: ExecutionTask, creds?: TaskCredentials): Promise<RecentTask | null> {
  const { state, api, log, rememberError, persistSnapshot, taskLog } = ctx
  const cfg = getConfig(api)
  log(`runClaimedTask - api: ${api}`)
  const baseUrl = creds?.knotworkUrl ?? cfg.knotworkBackendUrl
  const workspaceId = creds?.workspaceId ?? cfg.workspaceId
  const instanceId = creds?.pluginInstanceId ?? state.pluginInstanceId
  const jwt = creds?.jwt ?? state.jwt

  if (!baseUrl || !instanceId || !jwt || !workspaceId) {
    const missing = [
      !baseUrl && 'knotworkUrl',
      !instanceId && 'pluginInstanceId',
      !jwt && 'jwt',
      !workspaceId && 'workspaceId',
    ].filter(Boolean).join(',')
    log(`task:skipped missing=${missing}`)
    return null
  }

  const taskId = String(task.task_id)
  const taskStartedAt = new Date().toISOString()
  const persist = () => { void persistSnapshot() }
  state.lastTaskAt = taskStartedAt

  taskLog('task:received', taskId, {
    node: task.node_id ?? '', run: task.run_id ?? '', session: task.session_name ?? '',
  })
  upsertRecentTask(state, persist, {
    ...currentRecentTask(state, task, taskId, taskStartedAt),
    status: 'claimed', finishedAt: null, error: null,
  })
  log(`task:start id=${taskId} session=${task.session_name ?? 'n/a'}`)

  // Delivery ID for ACKing — stored on task.agent_key by convention (see inboxEventToTask)
  const deliveryId = task.agent_key ?? null

  let heartbeat: ReturnType<typeof setInterval> | null = null
  try {
    let heartbeatCount = 0
    heartbeat = setInterval(() => {
      heartbeatCount += 1
      log(`task:heartbeat id=${taskId} count=${heartbeatCount}`)
    }, 15_000)

    if (!task.trigger) {
      throw new Error('semantic-only mode requires trigger on every task')
    }
    const authorName = await resolveAuthorName(baseUrl, workspaceId, jwt)
    let result: TaskResult
    try {
      const semanticTransport = cfg.knotworkTransportMode === 'mcp'
        ? new KnotworkMcpTransport({
            baseUrl,
            workspaceId,
            jwt,
            authorName,
            pluginConfig: cfg,
          })
        : new KnotworkRestTransport({
            baseUrl,
            workspaceId,
            jwt,
            authorName,
            pluginConfig: cfg,
          })
      const semanticRuntime = new OpenClawThinkingRuntime(api)
      const orchestrator = new SemanticOrchestrator(semanticRuntime, semanticTransport)
      const semanticOutcome = await orchestrator.run({
        taskId,
        channelId: task.channel_id,
        sessionName: task.session_name,
        runId: task.run_id ?? null,
        trigger: task.trigger,
      }, {
        defaultAuthorName: authorName,
        debugEnabled: cfg.semanticProtocolDebug,
        debugDir: getSemanticSessionsDir(cfg),
      })
      result = semanticOutcome.dispatch.next_task_status === 'failed'
        ? {
            type: 'failed',
            error: semanticOutcome.dispatch.action_results
              .map((item) => item.reason)
              .filter(Boolean)
              .join('; ') || 'semantic action dispatch failed',
          }
        : { type: 'completed', output: '', next_branch: null }
      log(`task:semantic id=${taskId} batch=${semanticOutcome.dispatch.batch_status}`)
      taskLog('task:semantic', taskId, { batch: semanticOutcome.dispatch.batch_status })
    } catch (semanticErr) {
      const semanticMessage = semanticErr instanceof Error ? semanticErr.message : String(semanticErr)
      log(`task:semantic-failed id=${taskId} error=${JSON.stringify(semanticMessage)}`)
      taskLog('task:semantic-failed', taskId, {
        error: semanticMessage.slice(0, 500),
      })
      result = { type: 'failed', error: `semantic mode failed: ${semanticMessage}` }
    }
    if (heartbeat) clearInterval(heartbeat)
    const resultDetail =
      result.type === 'failed'
        ? ` error=${JSON.stringify(result.error)}`
        : ` outputPreview=${JSON.stringify(result.output.slice(0, 160))}`
    log(`task:done id=${taskId} type=${result.type}${resultDetail}`)
    const finishedAt = new Date().toISOString()

    const status = result.type === 'failed' ? 'failed' : 'completed'
    const error = result.type === 'failed' ? result.error : null
    const recentTask = {
      ...currentRecentTask(state, task, taskId, taskStartedAt),
      status, finishedAt, error,
    }
    upsertRecentTask(state, persist, recentTask)
    const taskLogExtra: Record<string, string> = { type: result.type }
    if (result.type === 'failed') taskLogExtra.error = result.error.slice(0, 500)
    if (result.type === 'completed') taskLogExtra.outputPreview = result.output.slice(0, 500)
    taskLog('task:sent', taskId, taskLogExtra)

    if (result.type === 'failed' && task.channel_id && isChannelNotifiableFailure(result.error)) {
      try {
        await postChannelMessage(
          baseUrl,
          workspaceId,
          jwt,
          task.channel_id,
          buildChannelFailureMessage(result.error),
          authorName,
          task.run_id,
        )
        log(`task:failure-posted id=${taskId} channel=${task.channel_id}`)
        taskLog('task:failure-posted', taskId, { channel: task.channel_id })
      } catch (postErr) {
        log(`task:failure-post-failed id=${taskId} channel=${task.channel_id} error=${rememberError(postErr)}`)
      }
    }

    // Archive the delivery after handling so it no longer loops in the active inbox.
    if (deliveryId) {
      try {
        await archiveInboxDelivery(baseUrl, workspaceId, jwt, deliveryId)
        log(`task:archived id=${taskId} delivery=${deliveryId}`)
      } catch (ackErr) {
        log(`task:archive-failed id=${taskId} delivery=${deliveryId} error=${rememberError(ackErr)}`)
      }
    }
    return recentTask
  } catch (err) {
    if (heartbeat) clearInterval(heartbeat)
    const error = rememberError(err)
    const recentTask = {
      ...currentRecentTask(state, task, taskId, taskStartedAt),
      status: 'failed', finishedAt: new Date().toISOString(), error,
    }
    upsertRecentTask(state, persist, recentTask)
    log(`task:error id=${taskId} ${error}`)
    taskLog('task:sent', taskId, { type: 'failed', error: error.slice(0, 200) })

    // Still archive on failure — agent tried and failed, avoid re-delivery loops.
    if (deliveryId) {
      try {
        await archiveInboxDelivery(baseUrl, workspaceId, jwt, deliveryId)
        log(`task:archived id=${taskId} delivery=${deliveryId} after_error=true`)
      } catch (ackErr) {
        log(`task:archive-failed id=${taskId} delivery=${deliveryId} error=${rememberError(ackErr)}`)
      }
    }
    return recentTask
  } finally {
    void persistSnapshot()
  }
}

/**
 * Full poll-and-run cycle: fetch unread inbox events, then execute each as a task.
 * Used as the background worker loop. Skips if JWT is missing.
 */
export async function pollAndRun(ctx: WorkerCtx): Promise<void> {
  const { state, api, log, rememberError, resetAuth, recoverAuth } = ctx
  const cfg = getConfig(api)
  const baseUrl = cfg.knotworkBackendUrl
  const workspaceId = cfg.workspaceId
  const jwt = state.jwt

  if (!baseUrl || !workspaceId || !jwt) {
    const missing = [
      !baseUrl && 'knotworkBackendUrl',
      !workspaceId && 'workspaceId',
      !jwt && 'jwt',
    ].filter(Boolean).join(',')
    log(`poll:skipped missing=${missing}`)
    return
  }

  log(`poll:start workspaceId=${workspaceId}`)
  let events: InboxEvent[]
  try {
    events = await pollInbox(baseUrl, workspaceId, jwt)
  } catch (err) {
    if (!isAuthError(err)) {
      log(`poll:error error=${rememberError(err)}`)
      throw err
    }
    log('auth:poll-inbox-invalid-credentials')
    await resetAuth()
    const recovered = await recoverAuth('poll_inbox_401')
    if (!recovered || !state.jwt) return
    log(`poll:retry workspaceId=${workspaceId}`)
    events = await pollInbox(baseUrl, workspaceId, state.jwt)
  }

  if (!events.length) {
    log(`poll:empty workspaceId=${workspaceId}`)
    return
  }

  log(`poll:got count=${events.length}`)
  for (const event of events) {
    const task = inboxEventToTask(event, state.guideContent)
    // Store delivery_id on agent_key for retrieval in runClaimedTask.
    task.agent_key = event.delivery_id ?? undefined
    await runClaimedTask(ctx, task)
  }
}

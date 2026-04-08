// worker.ts — Poll loop: fetch inbox → execute → ACK delivery.
// Task source changed from pullTask (queue) to pollInbox (inbox events).
// Auth changed from integrationSecret to JWT bearer token.

import {
  archiveInboxDelivery,
  fetchChannel,
  fetchChannelMessages,
  fetchObjectiveChain,
  getConfig,
  pollInbox,
  postChannelMessage,
} from '../openclaw/bridge'
import { executeTask } from '../openclaw/session'
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
  ObjectiveInfo,
  PluginState,
  RecentTask,
  RunningTaskInfo,
  TaskResult,
} from '../types'

const MAX_CHANNEL_MESSAGES = 20
const DEFAULT_AUTHOR_NAME = 'Knotwork Agent'

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
export function inboxEventToTask(event: InboxEvent, guideContent: string | null): ExecutionTask {
  const userPrompt = [
    `## New inbox event`,
    ``,
    `**Type**: ${event.item_type}`,
    `**Title**: ${event.title}`,
    event.subtitle ? `**Details**: ${event.subtitle}` : null,
    event.run_id ? `**Run ID**: ${event.run_id}` : null,
    event.channel_id ? `**Channel ID**: ${event.channel_id}` : null,
    event.escalation_id ? `**Escalation ID**: ${event.escalation_id}` : null,
    event.proposal_id ? `**Proposal ID**: ${event.proposal_id}` : null,
    `**Event ID**: ${event.id}`,
    `**Delivery ID**: ${event.delivery_id ?? 'none'}`,
    ``,
    `Refer to the workspace guide for how to handle this event type.`,
  ].filter((line) => line !== null).join('\n')

  return {
    task_id: event.id,
    channel_id: event.channel_id ?? undefined,
    session_name: event.channel_id ? `channel-${event.channel_id}` : `inbox-${event.item_type}-${event.id.slice(-8)}`,
    system_prompt: guideContent ?? undefined,
    user_prompt: userPrompt,
    trigger: {
      type: event.item_type,
      delivery_id: event.delivery_id,
      channel_id: event.channel_id,
      run_id: event.run_id,
      escalation_id: event.escalation_id,
      proposal_id: event.proposal_id,
      title: event.title,
      subtitle: event.subtitle,
    },
  }
}

function formatChannelSyncPrompt(
  event: InboxEvent,
  channel: { id: string; name: string; slug: string; channel_type: string; objective_id?: string | null },
  messages: Array<{ created_at: string; role: string; author_type: string; author_name: string | null; content: string }>,
  objectiveChain: ObjectiveInfo[] = [],
): string {
  const recentMessages = messages
    .slice(-MAX_CHANNEL_MESSAGES)
    .map((message) => {
      const author = message.author_name?.trim() || message.author_type
      return [
        `- [${message.created_at}] ${author} (${message.role})`,
        message.content,
      ].join('\n')
    })
    .join('\n\n')
  const objectiveContext = objectiveChain
    .map((objective, index) => {
      const label = index === objectiveChain.length - 1 ? 'current' : index === 0 ? 'root' : 'parent'
      return [
        `- ${label}: ${objective.code ? `${objective.code} ` : ''}${objective.title}`,
        `  id: ${objective.id}`,
        `  status: ${objective.status}, progress: ${objective.progress_percent}%`,
        objective.status_summary ? `  summary: ${objective.status_summary}` : null,
        objective.description ? `  description: ${objective.description}` : null,
        objective.key_results?.length ? `  key results: ${objective.key_results.join('; ')}` : null,
      ].filter((line) => line !== null).join('\n')
    })
    .join('\n')

  return [
    `## Channel sync`,
    ``,
    `Channel ID: ${channel.id}`,
    `Channel name: ${channel.name}`,
    `Channel slug: ${channel.slug}`,
    `Channel type: ${channel.channel_type}`,
    channel.objective_id ? `Objective ID: ${channel.objective_id}` : null,
    ``,
    objectiveChain.length > 0 ? `## Objective chain context` : null,
    objectiveChain.length > 0 ? `Root objective first; current objective last.` : null,
    objectiveChain.length > 0 ? objectiveContext : null,
    ``,
    `## Inbox item`,
    `Type: ${event.item_type}`,
    `Title: ${event.title}`,
    event.subtitle ? `Details: ${event.subtitle}` : null,
    event.run_id ? `Run ID: ${event.run_id}` : null,
    event.escalation_id ? `Escalation ID: ${event.escalation_id}` : null,
    event.proposal_id ? `Proposal ID: ${event.proposal_id}` : null,
    `Delivery ID: ${event.delivery_id ?? 'none'}`,
    ``,
    `## Recent channel messages`,
    recentMessages || `(no messages)`,
    ``,
    `Reply as the agent for this channel context. If you produce a user-facing reply, keep it suitable for posting back into the Knotwork channel.`,
  ].filter((line) => line !== null).join('\n')
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

    const semanticEnabled = Boolean(cfg.semanticActionProtocolEnabled)
    const semanticStrict = Boolean(cfg.semanticActionStrictMode)
    let usedSemanticPath = false
    let result: TaskResult
    if (semanticEnabled && task.trigger) {
      try {
        usedSemanticPath = true
        const semanticTransport = cfg.knotworkTransportMode === 'mcp'
          ? new KnotworkMcpTransport({
              baseUrl,
              workspaceId,
              jwt,
              authorName: DEFAULT_AUTHOR_NAME,
            })
          : new KnotworkRestTransport({
              baseUrl,
              workspaceId,
              jwt,
              authorName: DEFAULT_AUTHOR_NAME,
            })
        const semanticRuntime = new OpenClawThinkingRuntime(api)
        const orchestrator = new SemanticOrchestrator(semanticRuntime, semanticTransport)
        const semanticOutcome = await orchestrator.run({
          taskId,
          channelId: task.channel_id,
          sessionName: task.session_name,
          systemPrompt: task.system_prompt,
          legacyUserPrompt: task.user_prompt,
          runId: task.run_id ?? null,
          trigger: task.trigger,
        }, {
          defaultAuthorName: DEFAULT_AUTHOR_NAME,
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
        log(`task:semantic-failed id=${taskId} strict=${semanticStrict} error=${JSON.stringify(semanticMessage)}`)
        taskLog('task:semantic-failed', taskId, {
          strict: String(semanticStrict),
          error: semanticMessage.slice(0, 500),
        })
        if (semanticStrict) {
          result = { type: 'failed', error: `semantic mode failed: ${semanticMessage}` }
        } else {
          usedSemanticPath = false
          result = await executeTask(api, task)
        }
      }
    } else {
      result = await executeTask(api, task)
    }
    if (heartbeat) clearInterval(heartbeat)
    const resultDetail =
      result.type === 'failed'
        ? ` error=${JSON.stringify(result.error)}`
        : result.type === 'completed'
          ? ` outputPreview=${JSON.stringify(result.output.slice(0, 160))}`
          : ` questions=${JSON.stringify(result.questions.slice(0, 3))}`
    log(`task:done id=${taskId} type=${result.type}${resultDetail}`)
    const finishedAt = new Date().toISOString()

    const status = result.type === 'escalation' ? 'escalation'
      : result.type === 'failed' ? 'failed'
      : 'completed'
    const error = result.type === 'failed' ? result.error : null
    const recentTask = {
      ...currentRecentTask(state, task, taskId, taskStartedAt),
      status, finishedAt, error,
    }
    upsertRecentTask(state, persist, recentTask)
    const taskLogExtra: Record<string, string> = { type: result.type }
    if (result.type === 'failed') taskLogExtra.error = result.error.slice(0, 500)
    if (result.type === 'completed') taskLogExtra.outputPreview = result.output.slice(0, 500)
    if (result.type === 'escalation') taskLogExtra.questions = JSON.stringify(result.questions.slice(0, 3))
    taskLog('task:sent', taskId, taskLogExtra)

    const shouldImplicitlyPost = !usedSemanticPath
    if (shouldImplicitlyPost && task.channel_id && result.type !== 'failed') {
      const replyText = result.type === 'completed'
        ? result.output.trim()
        : (result.message ?? '').trim()
      if (replyText) {
        try {
          await postChannelMessage(
            baseUrl,
            workspaceId,
            jwt,
            task.channel_id,
            replyText,
            DEFAULT_AUTHOR_NAME,
            task.run_id,
          )
          log(`task:posted id=${taskId} channel=${task.channel_id}`)
        } catch (postErr) {
          log(`task:post-failed id=${taskId} channel=${task.channel_id} error=${rememberError(postErr)}`)
        }
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
    let task = inboxEventToTask(event, state.guideContent)
    if (event.channel_id) {
      try {
        const [channel, messages] = await Promise.all([
          fetchChannel(baseUrl, workspaceId, jwt, event.channel_id),
          fetchChannelMessages(baseUrl, workspaceId, jwt, event.channel_id),
        ])
        const objectiveChain = channel.objective_id
          ? await fetchObjectiveChain(baseUrl, workspaceId, jwt, channel.objective_id).catch(() => [])
          : []
        task = {
          ...task,
          user_prompt: formatChannelSyncPrompt(event, channel, messages, objectiveChain),
        }
        log(`poll:channel-sync channel=${event.channel_id} messages=${messages.length} objectives=${objectiveChain.length}`)
      } catch (channelErr) {
        log(`poll:channel-sync-failed channel=${event.channel_id} error=${rememberError(channelErr)}`)
      }
    }
    // Store delivery_id on agent_key for retrieval in runClaimedTask.
    task.agent_key = event.delivery_id ?? undefined
    await runClaimedTask(ctx, task)
  }
}

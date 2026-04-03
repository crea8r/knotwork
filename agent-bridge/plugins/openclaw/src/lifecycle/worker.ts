// worker.ts — Poll loop: fetch inbox → execute → ACK delivery.
// Task source changed from pullTask (queue) to pollInbox (inbox events).
// Auth changed from integrationSecret to JWT bearer token.

import { ackInboxDelivery, getConfig, pollInbox } from '../openclaw/bridge'
import { executeTask } from '../openclaw/session'
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
} from '../types'

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
    session_name: `inbox-${event.item_type}-${event.id.slice(-8)}`,
    system_prompt: guideContent ?? undefined,
    user_prompt: userPrompt,
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

    const result = await executeTask(api, task)
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

    // ACK the delivery so the inbox item is marked read.
    if (deliveryId) {
      try {
        await ackInboxDelivery(baseUrl, workspaceId, jwt, deliveryId)
        log(`task:ack id=${taskId} delivery=${deliveryId}`)
      } catch (ackErr) {
        log(`task:ack-failed id=${taskId} delivery=${deliveryId} error=${rememberError(ackErr)}`)
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

    // Still ACK on failure — agent tried and failed, avoid re-delivery loop.
    if (deliveryId) {
      try {
        await ackInboxDelivery(baseUrl, workspaceId, jwt, deliveryId)
        log(`task:ack id=${taskId} delivery=${deliveryId} after_error=true`)
      } catch (ackErr) {
        log(`task:ack-failed id=${taskId} delivery=${deliveryId} error=${rememberError(ackErr)}`)
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

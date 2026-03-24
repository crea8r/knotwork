// worker.ts — Poll loop: pull task → execute → post result → persist.

import { getConfig, postEvent, pullTask } from '../openclaw/bridge'
import { executeTask } from '../openclaw/session'
import { isInvalidCredentialsError } from './handshake'
import { MAX_RECENT_TASKS } from '../state/persist'
import type { TaskLogger } from '../state/tasklog'
import type { ExecutionTask, LooseRecord, OpenClawApi, PluginState, RecentTask, RunningTaskInfo } from '../types'

export type WorkerCtx = {
  state: PluginState
  api: OpenClawApi
  log: (msg: string) => void
  rememberError: (err: unknown) => string
  persistSnapshot: () => Promise<void>
  resetPersistedSecret: (resetInstanceId?: boolean) => Promise<void>
  recoverCredentials: (reason: string) => Promise<boolean>
  taskLog: TaskLogger
}

/** Minimal credentials context for running a pre-claimed task without full PluginState. */
export type TaskCredentials = {
  pluginInstanceId: string
  integrationSecret: string
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
 * Execute a pre-claimed task inside a gateway request context.
 * Called by the execute_task RPC handler with a task already pulled from the queue.
 * Does NOT call pullTask — the caller is responsible for providing the claimed task.
 *
 * Accepts explicit credentials so the subprocess never needs to read persisted state.
 */
export async function runClaimedTask(ctx: WorkerCtx, task: ExecutionTask, creds?: TaskCredentials): Promise<void> {
  const { state, api, log, rememberError, persistSnapshot, resetPersistedSecret, recoverCredentials, taskLog } = ctx
  // Prefer explicit credentials; fall back to state for backward compat (poll path).
  const baseUrl = creds?.knotworkUrl || getConfig(api).knotworkBackendUrl
  const instanceId = creds?.pluginInstanceId || state.pluginInstanceId
  const integrationSecret = creds?.integrationSecret || state.integrationSecret

  if (!baseUrl || !instanceId || !integrationSecret) {
    const missing = [!baseUrl && 'knotworkUrl', !instanceId && 'pluginInstanceId', !integrationSecret && 'integrationSecret'].filter(Boolean).join(',')
    log(`task:skipped missing=${missing}`)
    return
  }

  const taskId = String(task.task_id)
  const taskStartedAt = new Date().toISOString()
  const persist = () => { void persistSnapshot() }
  state.lastTaskAt = taskStartedAt

  // (1) task received
  taskLog('task:received', taskId, {
    node: task.node_id ?? '', run: task.run_id ?? '', session: task.session_name ?? '',
  })
  upsertRecentTask(state, persist, {
    ...currentRecentTask(state, task, taskId, taskStartedAt),
    status: 'claimed', finishedAt: null, error: null,
  })
  log(`task:start id=${taskId} node=${task.node_id} run=${task.run_id ?? 'n/a'} session=${task.session_name}`)

  async function submitEvent(eventType: string, payload: LooseRecord): Promise<void> {
    // Use explicit creds if provided; otherwise fall back to live state (supports credential recovery).
    const curId = creds ? instanceId : (state.pluginInstanceId ?? instanceId)
    const curSecret = creds ? integrationSecret : (state.integrationSecret ?? integrationSecret)
    if (!baseUrl || !curId || !curSecret) throw new Error(`Cannot submit ${eventType}: plugin credentials unavailable`)
    log(`event:post:start id=${taskId} type=${eventType}`)
    try {
      await postEvent(baseUrl, curId, curSecret, taskId, eventType, payload)
      log(`event:post:ok id=${taskId} type=${eventType}`)
    } catch (err) {
      if (!isInvalidCredentialsError(err) || creds) {
        // With explicit creds, skip recovery — creds are baked in at spawn time.
        log(`event:post:error id=${taskId} type=${eventType} error=${rememberError(err)}`)
        throw err
      }
      log(`auth:post-event-invalid-credentials type=${eventType}`)
      await resetPersistedSecret()
      const recovered = await recoverCredentials(`post_event_${eventType}_401`)
      if (!recovered || !state.integrationSecret || !state.pluginInstanceId) throw err
      await postEvent(baseUrl, state.pluginInstanceId, state.integrationSecret, taskId, eventType, payload)
      log(`event:post:ok id=${taskId} type=${eventType} retried=true`)
    }
  }

  // Fire-and-forget: do NOT await before executeTask.
  // Awaiting an HTTP call here breaks OpenClaw's gateway request context,
  // causing subagent.run() to throw "only available during a gateway request".
  void submitEvent('log', {
    entry_type: 'action',
    content: 'Plugin started task execution',
    metadata: { node_id: task.node_id, run_id: task.run_id, session_name: task.session_name },
  }).catch((err) => { log(`event:post:nonfatal id=${taskId} type=log error=${rememberError(err)}`) })

  let heartbeat: ReturnType<typeof setInterval> | null = null
  try {
    let heartbeatCount = 0
    heartbeat = setInterval(() => {
      heartbeatCount += 1
      submitEvent('log', {
        entry_type: 'progress',
        content: `OpenClaw is still working (heartbeat ${heartbeatCount})`,
        metadata: { heartbeat: heartbeatCount, node_id: task.node_id, run_id: task.run_id },
      }).catch(() => { /* non-fatal */ })
    }, 15000)

    const result = await executeTask(api, task)
    if (heartbeat) clearInterval(heartbeat)
    log(`task:done id=${taskId} type=${result.type}`)
    const finishedAt = new Date().toISOString()

    if (result.type === 'escalation') {
      upsertRecentTask(state, persist, { ...currentRecentTask(state, task, taskId, taskStartedAt), status: 'escalation', finishedAt, error: null })
      taskLog('task:sent', taskId, { type: 'escalation' })  // (4)
      await submitEvent('escalation', { questions: result.questions, options: result.options, message: result.message })
    } else if (result.type === 'failed') {
      upsertRecentTask(state, persist, { ...currentRecentTask(state, task, taskId, taskStartedAt), status: 'failed', finishedAt, error: result.error })
      taskLog('task:sent', taskId, { type: 'failed', error: result.error.slice(0, 200) })  // (4)
      await submitEvent('failed', { error: result.error })
    } else {
      upsertRecentTask(state, persist, { ...currentRecentTask(state, task, taskId, taskStartedAt), status: 'completed', finishedAt, error: null })
      taskLog('task:sent', taskId, { type: 'completed', next_branch: result.next_branch ?? '' })  // (4)
      await submitEvent('completed', { output: result.output, next_branch: result.next_branch })
    }
  } catch (err) {
    const error = rememberError(err)
    upsertRecentTask(state, persist, { ...currentRecentTask(state, task, taskId, taskStartedAt), status: 'failed', finishedAt: new Date().toISOString(), error })
    log(`task:error id=${taskId} ${error}`)
    taskLog('task:sent', taskId, { type: 'failed', error: error.slice(0, 200) })  // (4)
    await submitEvent('failed', { error }).catch((submitErr) => {
      log(`task:error-report-failed id=${taskId} error=${rememberError(submitErr)}`)
    })
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    void persistSnapshot()
  }
}

/**
 * Full poll-and-run cycle: pull a task from the queue, then execute it.
 * Used as a fallback when execute_task is called without a pre-claimed task.
 */
export async function pollAndRun(ctx: WorkerCtx): Promise<void> {
  const { state, api, log, rememberError, resetPersistedSecret, recoverCredentials } = ctx
  const cfg = getConfig(api)
  const baseUrl = cfg.knotworkBackendUrl
  const instanceId = state.pluginInstanceId
  const secret = state.integrationSecret

  if (!baseUrl || !instanceId || !secret) {
    const missing = [!baseUrl && 'knotworkBackendUrl', !instanceId && 'pluginInstanceId', !secret && 'integrationSecret'].filter(Boolean).join(',')
    log(`poll:skipped missing=${missing}`)
    return
  }

  let task: ExecutionTask | null = null
  log(`pull:start instanceId=${instanceId}`)
  try {
    task = await pullTask(baseUrl, instanceId, secret)
  } catch (err) {
    if (!isInvalidCredentialsError(err)) {
      log(`pull:error instanceId=${instanceId} error=${rememberError(err)}`)
      throw err
    }
    log('auth:pull-task-invalid-credentials')
    await resetPersistedSecret()
    const recovered = await recoverCredentials('pull_task_401')
    if (!recovered || !state.integrationSecret || !state.pluginInstanceId) return
    log(`pull:retry instanceId=${state.pluginInstanceId}`)
    task = await pullTask(baseUrl, state.pluginInstanceId, state.integrationSecret)
  }
  if (!task) { log(`pull:empty instanceId=${instanceId}`); return }

  await runClaimedTask(ctx, task)
}

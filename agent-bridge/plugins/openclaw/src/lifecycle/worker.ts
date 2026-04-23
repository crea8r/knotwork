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
import type { KnotworkTransport } from '../transport/contracts'
import { isAuthError } from './auth'
import { buildChannelFailureMessage } from './failure-message.js'
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
  WorkPacket,
} from '../types'

const DEFAULT_AUTHOR_NAME = 'Knotwork Agent'

function normalizeTimestamp(value: string | null | undefined): number {
  const parsed = new Date(String(value ?? '')).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function compareInboxEvents(a: InboxEvent, b: InboxEvent): number {
  const priorityDiff = inboxEventPriority(a) - inboxEventPriority(b)
  if (priorityDiff !== 0) return priorityDiff
  const createdDiff = normalizeTimestamp(b.created_at) - normalizeTimestamp(a.created_at)
  if (createdDiff !== 0) return createdDiff
  return String(a.id).localeCompare(String(b.id))
}

function summarizeInboxEvent(event: InboxEvent): Record<string, unknown> {
  return {
    id: event.id,
    item_type: event.item_type,
    delivery_id: event.delivery_id,
    title: event.title,
    subtitle: event.subtitle,
    status: event.status,
    run_id: event.run_id,
    channel_id: event.channel_id,
    escalation_id: event.escalation_id,
    proposal_id: event.proposal_id ?? null,
    message_id: event.message_id ?? null,
    asset_type: event.asset_type ?? null,
    asset_id: event.asset_id ?? null,
    asset_path: event.asset_path ?? null,
    unread: event.unread,
    created_at: event.created_at,
  }
}

function sessionAssetDetail(events: InboxEvent[]): Record<string, unknown> | null {
  const assetEvent = events.find((event) => event.asset_type || event.asset_id || event.asset_path)
  if (!assetEvent) return null
  return {
    type: assetEvent.asset_type ?? null,
    id: assetEvent.asset_id ?? null,
    path: assetEvent.asset_path ?? null,
  }
}

export function inboxEventPriority(event: InboxEvent): number {
  switch (event.item_type) {
    case 'mentioned_message':
      return 0
    case 'escalation_assigned':
    case 'escalation':
      return 1
    case 'message_posted':
      return 2
    case 'task_assigned':
      return 3
    case 'run_event':
      return 4
    case 'workspace_announcement':
      return 5
    default:
      return 10
  }
}

export function claimKeyForInboxEvent(event: InboxEvent): string {
  if (typeof event.channel_id === 'string' && event.channel_id.trim()) {
    return `channel:${event.channel_id.trim()}`
  }
  if (typeof event.run_id === 'string' && event.run_id.trim()) {
    return `run:${event.run_id.trim()}`
  }
  if (typeof event.escalation_id === 'string' && event.escalation_id.trim()) {
    return `escalation:${event.escalation_id.trim()}`
  }
  if (typeof event.proposal_id === 'string' && event.proposal_id.trim()) {
    return `proposal:${event.proposal_id.trim()}`
  }
  if (typeof event.asset_path === 'string' && event.asset_path.trim()) {
    return `asset:${event.asset_type ?? 'asset'}:${event.asset_path.trim()}`
  }
  if (typeof event.asset_id === 'string' && event.asset_id.trim()) {
    return `asset:${event.asset_type ?? 'asset'}:${event.asset_id.trim()}`
  }
  return `event:${event.id}`
}

export function buildBundledInboxTasks(events: InboxEvent[], _guideContent: string | null): ExecutionTask[] {
  const grouped = new Map<string, InboxEvent[]>()
  for (const event of events) {
    const claimKey = claimKeyForInboxEvent(event)
    const items = grouped.get(claimKey) ?? []
    items.push(event)
    grouped.set(claimKey, items)
  }

  return Array.from(grouped.entries())
    .map(([claimKey, groupedEvents]) => {
      const sortedEvents = [...groupedEvents].sort(compareInboxEvents)
      const primary = sortedEvents[0]
      const detail: Record<string, unknown> = {}
      if (primary.message_id) detail.message_id = primary.message_id
      if (primary.run_id) detail.run_id = primary.run_id
      if (primary.escalation_id) detail.escalation_id = primary.escalation_id
      if (primary.proposal_id) detail.proposal_id = primary.proposal_id
      if (primary.asset_type || primary.asset_id || primary.asset_path) {
        detail.asset = {
          type: primary.asset_type ?? null,
          id: primary.asset_id ?? null,
          path: primary.asset_path ?? null,
        }
      }
      const sessionAsset = sessionAssetDetail(sortedEvents)
      if (sessionAsset) detail.session_asset = sessionAsset
      detail.session_claim_key = claimKey
      detail.primary_event_id = primary.id
      detail.primary_event_type = primary.item_type
      detail.primary_event_created_at = primary.created_at
      detail.session_event_count = sortedEvents.length
      detail.session_event_types = Array.from(new Set(sortedEvents.map((event) => event.item_type)))
      detail.session_events = sortedEvents.map(summarizeInboxEvent)

      const deliveryIds = sortedEvents
        .map((event) => event.delivery_id)
        .filter((deliveryId): deliveryId is string => typeof deliveryId === 'string' && deliveryId.trim().length > 0)

      return {
        task_id: primary.id,
        claim_key: claimKey,
        channel_id: primary.channel_id ?? undefined,
        session_name: primary.channel_id
          ? `channel-${primary.channel_id}`
          : `inbox-${claimKey.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        delivery_ids: Array.from(new Set(deliveryIds)),
        inbox_events: sortedEvents,
        trigger: {
          type: primary.item_type,
          delivery_id: primary.delivery_id,
          channel_id: primary.channel_id,
          title: primary.title,
          subtitle: primary.subtitle,
          detail,
        },
      } satisfies ExecutionTask
    })
    .sort((a, b) => compareInboxEvents((a.inbox_events ?? [])[0] as InboxEvent, (b.inbox_events ?? [])[0] as InboxEvent))
}

async function postFailureToChannel(input: {
  baseUrl: string
  workspaceId: string
  jwt: string
  channelId: string
  error: string
  authorName: string
  task: ExecutionTask
  failurePacket?: WorkPacket | null
  log: (msg: string) => void
  taskLog: TaskLogger
  taskId: string
  rememberError: (err: unknown) => string
}): Promise<void> {
  const {
    baseUrl,
    workspaceId,
    jwt,
    channelId,
    error,
    authorName,
    task,
    failurePacket,
    log,
    taskLog,
    taskId,
    rememberError,
  } = input

  try {
    await postChannelMessage(
      baseUrl,
      workspaceId,
      jwt,
      channelId,
      buildChannelFailureMessage(error),
      authorName,
      fallbackRunId(task, failurePacket),
    )
    log(`task:failure-posted id=${taskId} channel=${channelId}`)
    taskLog('task:failure-posted', taskId, { channel: channelId })
  } catch (postErr) {
    log(`task:failure-post-failed id=${taskId} channel=${channelId} error=${rememberError(postErr)}`)
  }
}

function fallbackRunId(task: ExecutionTask, packet?: WorkPacket | null): string | undefined {
  const detail = (task.trigger?.detail && typeof task.trigger.detail === 'object')
    ? task.trigger.detail as Record<string, unknown>
    : null
  const triggerRunId = typeof detail?.run_id === 'string' && detail.run_id.trim()
    ? detail.run_id.trim()
    : undefined
  return packet?.refs.run_id
    ?? task.run_id
    ?? triggerRunId
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
export function inboxEventToTask(event: InboxEvent, guideContent: string | null): ExecutionTask {
  return buildBundledInboxTasks([event], guideContent)[0]
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

  const deliveryIds = Array.from(new Set([
    ...((Array.isArray(task.delivery_ids) ? task.delivery_ids : []).filter((deliveryId): deliveryId is string => typeof deliveryId === 'string' && deliveryId.trim().length > 0)),
    ...(typeof task.agent_key === 'string' && task.agent_key.trim() ? [task.agent_key.trim()] : []),
  ]))
  let failurePacket: WorkPacket | null = null

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
        failurePacket = await semanticTransport.getWorkPacket({
          taskId,
          trigger: task.trigger,
          sessionName: task.session_name,
        })
      } catch {
        failurePacket = null
      }
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

    if (result.type === 'failed' && task.channel_id) {
      await postFailureToChannel({
        baseUrl,
        workspaceId,
        jwt,
        channelId: task.channel_id,
        error: result.error,
        authorName,
        task,
        failurePacket,
        log,
        taskLog,
        taskId,
        rememberError,
      })
    }

    // Archive the delivery after handling so it no longer loops in the active inbox.
    for (const deliveryId of deliveryIds) {
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

    if (task.channel_id) {
      const authorName = await resolveAuthorName(baseUrl, workspaceId, jwt)
      await postFailureToChannel({
        baseUrl,
        workspaceId,
        jwt,
        channelId: task.channel_id,
        error,
        authorName,
        task,
        failurePacket,
        log,
        taskLog,
        taskId,
        rememberError,
      })
    }

    // Still archive on failure — agent tried and failed, avoid re-delivery loops.
    for (const deliveryId of deliveryIds) {
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
  for (const task of buildBundledInboxTasks(events, state.guideContent)) {
    await runClaimedTask(ctx, task)
  }
}

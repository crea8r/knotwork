// timers.ts — Background intervals: poll loop, lease renewal, TTL watchdog, graceful shutdown.

import { fetchGuide, getConfig, pollInbox } from '../openclaw/bridge'
import { renewRuntimeLease, releaseRuntimeLease, releaseRuntimeLeaseSync, LEASE_RENEW_INTERVAL_MS } from '../state/lease'
import { claimTask } from '../state/task-claim'
import { removeRunningTask, inboxEventToTask } from './worker'
import { spawnExecuteTask, type SpawnDeps } from './spawn'
import type { TaskLogger } from '../state/tasklog'
import type { OpenClawApi, PluginState } from '../types'

export type TimersDeps = {
  state: PluginState
  api: OpenClawApi
  log: (msg: string) => void
  persistSnapshot?: () => Promise<void>
  recoverAuth: (reason: string) => Promise<boolean>
  activeSpawns: Map<string, { startedAt: string }>
  lockOwnerRef: { value: boolean }
  getLockPath: () => string
  maxConcurrent: number
  pollMs: number
  maxGatewayAttempts: number
  saturationRetryMs: number
  spawnTtlMs: number
  taskLog: TaskLogger
  taskLogPath: string
}

export function startTimers(deps: TimersDeps): void {
  const { state, api, log, persistSnapshot, recoverAuth, activeSpawns, lockOwnerRef, getLockPath, maxConcurrent, pollMs, maxGatewayAttempts, saturationRetryMs, spawnTtlMs, taskLog, taskLogPath } = deps
  let reAuthInProgress = false

  function wasRecentlyHandled(taskId: string): boolean {
    const recent = state.recentTasks.find((item) => item.taskId === taskId)
    if (!recent) return false
    if (recent.status === 'claimed') return true
    const finishedAt = recent.finishedAt ? new Date(recent.finishedAt).getTime() : 0
    return finishedAt > 0 && Date.now() - finishedAt < 5 * 60_000
  }

  function buildSpawnDeps(): SpawnDeps {
    const cfg = getConfig(api)
    return {
      state, log, api, activeSpawns, taskLog, maxConcurrent, maxGatewayAttempts, saturationRetryMs,
      persistSnapshot,
      jwt: state.jwt ?? '',
      workspaceId: cfg.workspaceId ?? '',
      knotworkUrl: cfg.knotworkBackendUrl ?? '',
      taskLogPath,
    }
  }

  function normalizeEventText(value: string | null | undefined): string {
    return String(value ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160)
  }

  function collapseSiblingEvents<T extends {
    item_type: string
    channel_id: string | null
    title: string
    subtitle: string | null
  }>(events: T[]): T[] {
    const mentionKeys = new Set<string>()
    for (const event of events) {
      if (event.item_type !== 'mentioned_message') continue
      const channelId = event.channel_id ?? ''
      const contentKey = normalizeEventText(event.subtitle || event.title)
      mentionKeys.add(`${channelId}::${contentKey}`)
    }
    return events.filter((event) => {
      if (event.item_type !== 'message_posted') return true
      const channelId = event.channel_id ?? ''
      const contentKey = normalizeEventText(event.subtitle || event.title)
      return !mentionKeys.has(`${channelId}::${contentKey}`)
    })
  }

  // ── Poll loop ──────────────────────────────────────────────────────────────
  setInterval(() => {
    if (!state.backgroundWorkerEnabled || !state.jwt) return
    if (activeSpawns.size >= maxConcurrent) return
    const cfg = getConfig(api)
    const baseUrl = cfg.knotworkBackendUrl
    const workspaceId = cfg.workspaceId
    const jwt = state.jwt
    if (!baseUrl || !workspaceId || !jwt) return

    void (async () => {
      try {
        const guide = await fetchGuide(baseUrl, workspaceId, jwt)
        if (guide.guide_version !== state.guideVersion || guide.guide_md !== state.guideContent) {
          state.guideVersion = guide.guide_version
          state.guideContent = guide.guide_md
          log(`guide:loaded version=${guide.guide_version} hasContent=${Boolean(guide.guide_md)}`)
        }
        const events = collapseSiblingEvents(await pollInbox(baseUrl, workspaceId, jwt))
        log(`poll:got count=${events.length} active=${activeSpawns.size}`)
        for (const event of events) {
          if (activeSpawns.size >= maxConcurrent) break
          const task = inboxEventToTask(event, state.guideContent)
          if (activeSpawns.has(task.task_id)) {
            log(`poll:skip-duplicate task=${task.task_id} delivery=${event.delivery_id ?? 'none'}`)
            continue
          }
          if (wasRecentlyHandled(task.task_id)) {
            log(`poll:skip-recent task=${task.task_id} delivery=${event.delivery_id ?? 'none'}`)
            continue
          }
          const claimed = await claimTask(state.runtimeLockPath ?? getLockPath(), task.task_id, event.delivery_id)
          if (!claimed) {
            log(`poll:skip-claimed task=${task.task_id} delivery=${event.delivery_id ?? 'none'}`)
            continue
          }
          task.agent_key = event.delivery_id ?? undefined
          void spawnExecuteTask(buildSpawnDeps(), task, 'poll')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`poll:error ${msg}`)
        if (/\(401\)|unauthorized|invalid.*token/i.test(msg)) {
          if (reAuthInProgress) return
          reAuthInProgress = true
          log('poll:credentials-rejected clearing_jwt=true triggering_reauth=true')
          state.jwt = null
          void recoverAuth('poll_401').finally(() => { reAuthInProgress = false })
        }
      }
    })()
  }, pollMs).unref()

  // ── Lease renewal ──────────────────────────────────────────────────────────
  setInterval(() => {
    void renewRuntimeLease(getLockPath(), lockOwnerRef.value)
  }, LEASE_RENEW_INTERVAL_MS).unref()

  // ── Spawn TTL watchdog ─────────────────────────────────────────────────────
  setInterval(() => {
    const now = Date.now()
    for (const [id, info] of activeSpawns.entries()) {
      const age = now - new Date(info.startedAt).getTime()
      if (age > spawnTtlMs) {
        log(`spawn:ttl-evict id=${id} age=${Math.round(age / 60000)}m — subprocess never exited, evicting from pool`)
        activeSpawns.delete(id)
        removeRunningTask(state, id)
      }
    }
  }, 60_000).unref()

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  process.once('exit', () => { releaseRuntimeLeaseSync(getLockPath(), lockOwnerRef.value) })
  process.once('SIGINT', () => { void releaseRuntimeLease(getLockPath(), lockOwnerRef.value).finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void releaseRuntimeLease(getLockPath(), lockOwnerRef.value).finally(() => process.exit(0)) })
}

// timers.ts — Background intervals: poll loop, lease renewal, TTL watchdog, graceful shutdown.

import { getConfig, pullTask } from '../openclaw/bridge'
import { renewRuntimeLease, releaseRuntimeLease, releaseRuntimeLeaseSync, LEASE_RENEW_INTERVAL_MS } from '../state/lease'
import { removeRunningTask } from './worker'
import { spawnExecuteTask, type SpawnDeps } from './spawn'
import type { TaskLogger } from '../state/tasklog'
import type { OpenClawApi, PluginState } from '../types'

export type TimersDeps = {
  state: PluginState
  api: OpenClawApi
  log: (msg: string) => void
  persistCredentials: () => Promise<void>
  recoverCredentials: (reason: string) => Promise<boolean>
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
  const { state, api, log, persistCredentials, recoverCredentials, activeSpawns, lockOwnerRef, getLockPath, maxConcurrent, pollMs, maxGatewayAttempts, saturationRetryMs, spawnTtlMs, taskLog, taskLogPath } = deps
  let rehandshakeInProgress = false

  function buildSpawnDeps(): SpawnDeps {
    const cfg = getConfig(api)
    return {
      state, log, api, activeSpawns, taskLog, maxConcurrent, maxGatewayAttempts, saturationRetryMs,
      integrationSecret: state.integrationSecret ?? '',
      knotworkUrl: cfg.knotworkBackendUrl ?? '',
      taskLogPath,
    }
  }

  // ── Poll loop ──────────────────────────────────────────────────────────────
  setInterval(() => {
    if (!state.backgroundWorkerEnabled || !state.integrationSecret) return
    if (activeSpawns.size >= maxConcurrent) return
    const baseUrl = getConfig(api).knotworkBackendUrl
    const instanceId = state.pluginInstanceId
    const secret = state.integrationSecret
    if (!baseUrl || !instanceId || !secret) return

    void (async () => {
      try {
        const capacity = { tasksRunning: activeSpawns.size, slotsAvailable: Math.max(0, maxConcurrent - activeSpawns.size) }
        const task = await pullTask(baseUrl, instanceId, secret, capacity)
        if (!task) return
        void spawnExecuteTask(buildSpawnDeps(), task, 'poll')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`poll:error ${msg}`)
        if (/\(401\)|invalid plugin credentials/i.test(msg)) {
          if (rehandshakeInProgress) return
          rehandshakeInProgress = true
          log('poll:credentials-rejected clearing_secret=true triggering_rehandshake=true')
          state.integrationSecret = null
          void persistCredentials()
          void recoverCredentials('poll_401').finally(() => { rehandshakeInProgress = false })
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

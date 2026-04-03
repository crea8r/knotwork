// startup.ts — State hydration from disk and background worker initialization.

import { readPersistedState } from '../state/persist'
import { acquireRuntimeLease } from '../state/lease'
import { runAuth, scheduleAuthRetry } from './auth'
import { resolveInstanceId } from '../openclaw/bridge'
import type { TimerRef } from './auth'
import type { OpenClawApi, PluginConfig, PluginState } from '../types'

export function detectActivationContext(): string {
  try {
    const args = Array.isArray(process?.argv) ? process.argv.map((a) => String(a).toLowerCase()) : []
    if (args.includes('gateway') && args.includes('call')) return 'cli_gateway_call'
    if (args.includes('plugins') && (args.includes('list') || args.includes('inspect'))) return 'cli_plugins'
    if (args.includes('--help') || args.includes('-h')) return 'cli_help'
  } catch { /* ignore */ }
  return 'runtime'
}

export type StartupDeps = {
  state: PluginState
  cfg: PluginConfig
  log: (msg: string) => void
  rememberError: (err: unknown) => string
  persistSnapshot: () => Promise<void>
  hCtx: {
    state: PluginState
    api: OpenClawApi
    log: (msg: string) => void
    rememberError: (err: unknown) => string
    persistState: () => Promise<void>
  }
  timerRef: TimerRef
  stateFilePath: string
  lockPath: string
  lockOwnerRef: { value: boolean }
  onHydrated: () => void
}

export function startHydration(deps: StartupDeps): void {
  const { state, cfg, log, rememberError, persistSnapshot, hCtx, timerRef, stateFilePath, lockPath, lockOwnerRef, onHydrated } = deps

  readPersistedState(stateFilePath)
    .then(async (persisted) => {
      state.stateFilePath = stateFilePath
      const configuredId = cfg.pluginInstanceId?.trim() || null
      state.pluginInstanceId = configuredId || persisted.pluginInstanceId || resolveInstanceId(cfg)
      if (persisted.jwt) {
        state.jwt = persisted.jwt
        state.jwtExpiresAt = persisted.jwtExpiresAt ?? null
        log(`state:loaded jwt=...${persisted.jwt.slice(-8)} expiresAt=${state.jwtExpiresAt ?? 'unknown'}`)
      }
      state.guideVersion = persisted.guideVersion ?? null
      state.lastAuthAt = persisted.lastAuthAt ?? state.lastAuthAt
      state.lastAuthOk = persisted.lastAuthOk ?? state.lastAuthOk
      state.lastError = persisted.lastError ?? state.lastError
      state.lastTaskAt = persisted.lastTaskAt ?? state.lastTaskAt
      state.runtimeLockPath = persisted.runtimeLockPath ?? state.runtimeLockPath
      state.runtimeLeaseOwnerPid = persisted.runtimeLeaseOwnerPid ?? state.runtimeLeaseOwnerPid
      state.recentTasks = Array.isArray(persisted.recentTasks) ? persisted.recentTasks : state.recentTasks
      // Intentionally NOT restoring logs — each session starts fresh.
      onHydrated()
      await persistSnapshot()

      if (state.activationContext !== 'runtime') {
        log(`startup:background-disabled context=${state.activationContext}`)
        return
      }
      state.runtimeLockPath = lockPath
      const lease = await acquireRuntimeLease(lockPath, () => { void persistSnapshot() })
      if (!lease.acquired) { log('startup:background-disabled runtime_lease=busy'); return }
      lockOwnerRef.value = true
      state.runtimeLeaseOwnerPid = lease.pid
      state.backgroundWorkerEnabled = true
      log(`startup:background-enabled context=${state.activationContext}`)

      if (!state.jwt && cfg.autoAuthOnStart && cfg.knotworkBackendUrl && cfg.privateKeyPath) {
        runAuth(hCtx).catch((err: unknown) => {
          state.lastAuthOk = false
          state.lastAuthAt = new Date().toISOString()
          state.lastError = rememberError(err)
          log(`startup:auth-failed ${state.lastError}`)
          scheduleAuthRetry(hCtx, timerRef, 'startup_failed')
        })
      }
    })
    .catch((err: unknown) => {
      onHydrated()
      state.lastError = rememberError(err)
      log(`state:load-failed ${state.lastError}`)
    })
}

// plugin.ts — OpenClaw plugin entry point.
// Debug: openclaw gateway call knotwork.status | knotwork.logs | knotwork.handshake | knotwork.process_once
// All log lines also written to stdout → `docker logs <container> | grep knotwork-bridge`

/* eslint-disable no-console */
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getConfig, getGatewayConfig, resolveInstanceId } from './openclaw/bridge'
import { runHandshake, scheduleHandshakeRetry, recoverCredentials as _recoverCredentials } from './lifecycle/handshake'
import type { TimerRef } from './lifecycle/handshake'
import { acquireRuntimeLease, releaseRuntimeLease, releaseRuntimeLeaseSync } from './state/lease'
import { readPersistedState, readPersistedCredentials } from './state/persist'
import { pollAndRun as _pollAndRun } from './lifecycle/worker'
import { registerRpcMethods } from './lifecycle/rpc'
import { isOperatorScopeError } from './openclaw/session'
import type { OpenClawApi, PluginState } from './types'

const PLUGIN_ID = 'knotwork-bridge'
const STATE_FILE = 'knotwork-bridge-state.json'
// Lock and credentials live inside the plugin extension dir so `rm -rf extensions/knotwork-bridge` cleans them up.
const RUNTIME_LOCK_FILE = 'runtime.lock'
const CREDENTIALS_FILE = 'credentials.json'

export function activate(api: OpenClawApi): void {
  let runtimeLockOwner = false
  let stateHydrated = false
  let snapshotWrite: Promise<void> = Promise.resolve()
  const timerRef: TimerRef = { current: null }

  const state: PluginState = {
    pluginInstanceId: null, integrationSecret: null, stateFilePath: null, runtimeLockPath: null,
    activationContext: null, backgroundWorkerEnabled: false, lastHandshakeAt: null,
    lastHandshakeOk: false, lastError: null, lastTaskAt: null, runningTaskId: null,
    runtimeLeaseOwnerPid: null, recentTasks: [], logs: [],
  }

  function getHomeDir(): string {
    try { return homedir() } catch { return process?.env?.HOME || '.' }
  }
  function getStateFilePath(): string { return join(getHomeDir(), '.openclaw', STATE_FILE) }
  // __dirname = ~/.openclaw/extensions/knotwork-bridge — co-located with the bundle.
  // Both files are cleaned up automatically by `rm -rf extensions/knotwork-bridge` on uninstall.
  function getRuntimeLockPath(): string { return join(__dirname, RUNTIME_LOCK_FILE) }
  function getCredentialsFilePath(): string { return join(__dirname, CREDENTIALS_FILE) }

  function log(msg: string): void {
    const line = `${new Date().toISOString()} ${msg}`
    state.logs = [...state.logs, line].slice(-200)
    console.log(`[${PLUGIN_ID}] ${line}`)
    if (stateHydrated) void persistSnapshot()
  }

  function rememberError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error)
    state.lastError = text
    return text
  }

  // Writes pluginInstanceId + history. Does NOT include integrationSecret — that goes to credentials.json.
  async function persistSnapshot(): Promise<void> {
    const path = state.stateFilePath ?? getStateFilePath()
    state.stateFilePath = path
    snapshotWrite = snapshotWrite
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify({
          pluginInstanceId: state.pluginInstanceId,
          lastHandshakeAt: state.lastHandshakeAt, lastHandshakeOk: state.lastHandshakeOk,
          lastError: state.lastError, lastTaskAt: state.lastTaskAt,
          runtimeLockPath: state.runtimeLockPath, runtimeLeaseOwnerPid: state.runtimeLeaseOwnerPid,
          recentTasks: state.recentTasks, logs: state.logs,
        }, null, 2))
      })
    return snapshotWrite
  }

  // Writes integrationSecret to extensions/knotwork-bridge/credentials.json.
  // This file is auto-removed when the plugin is uninstalled (rm -rf extensions/knotwork-bridge).
  async function persistCredentials(): Promise<void> {
    const path = getCredentialsFilePath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify({ integrationSecret: state.integrationSecret }, null, 2))
  }

  async function resetPersistedSecret(resetInstanceId = false): Promise<void> {
    if (resetInstanceId) state.pluginInstanceId = null
    state.integrationSecret = null
    await persistSnapshot()
    await persistCredentials()
  }

  // hCtx.persistState writes both files: state (identity + history) and credentials (secret).
  const persistState = async (): Promise<void> => { await persistSnapshot(); await persistCredentials() }
  const hCtx = { state, api, log, rememberError, persistState }
  const recoverCredentials = (reason: string) => _recoverCredentials(hCtx, timerRef, reason)
  const wCtx = { state, api, log, rememberError, persistSnapshot, resetPersistedSecret, recoverCredentials }

  registerRpcMethods({
    state, api, log, rememberError,
    runHandshake: (overrides) => runHandshake(hCtx, overrides),
    pollAndRun: () => _pollAndRun(wCtx),
    resetPersistedSecret,
  })

  // ── Startup ───────────────────────────────────────────────────────────────────

  function detectActivationContext(): string {
    try {
      const args = Array.isArray(process?.argv) ? process.argv.map((a) => String(a).toLowerCase()) : []
      if (args.includes('gateway') && args.includes('call')) return 'cli_gateway_call'
      if (args.includes('plugins') && (args.includes('list') || args.includes('inspect'))) return 'cli_plugins'
      if (args.includes('--help') || args.includes('-h')) return 'cli_help'
    } catch { /* ignore */ }
    return 'runtime'
  }

  const cfg = getConfig(api)
  state.activationContext = detectActivationContext()

  readPersistedState(getStateFilePath())
    .then(async (persisted) => {
      state.stateFilePath = getStateFilePath()
      const configuredId = cfg.pluginInstanceId?.trim() || null
      state.pluginInstanceId = configuredId || persisted.pluginInstanceId || resolveInstanceId(cfg)

      // Load integrationSecret from credentials.json (co-located with bundle, cleaned on uninstall).
      const creds = await readPersistedCredentials(getCredentialsFilePath())
      if (creds.integrationSecret && (!configuredId || configuredId === persisted.pluginInstanceId)) {
        state.integrationSecret = creds.integrationSecret
        log(`state:loaded secret=...${creds.integrationSecret.slice(-4)}`)
      } else if (creds.integrationSecret && configuredId && configuredId !== persisted.pluginInstanceId) {
        log('state:ignored persisted secret due_to_instance_id_mismatch=true')
      }
      state.lastHandshakeAt = persisted.lastHandshakeAt ?? state.lastHandshakeAt
      state.lastHandshakeOk = persisted.lastHandshakeOk ?? state.lastHandshakeOk
      state.lastError = persisted.lastError ?? state.lastError
      state.lastTaskAt = persisted.lastTaskAt ?? state.lastTaskAt
      state.runtimeLockPath = persisted.runtimeLockPath ?? state.runtimeLockPath
      state.runtimeLeaseOwnerPid = persisted.runtimeLeaseOwnerPid ?? state.runtimeLeaseOwnerPid
      state.recentTasks = Array.isArray(persisted.recentTasks) ? persisted.recentTasks : state.recentTasks
      state.logs = Array.isArray(persisted.logs) ? persisted.logs : state.logs
      stateHydrated = true
      await persistSnapshot()

      if (state.activationContext !== 'runtime') {
        log(`startup:background-disabled context=${state.activationContext}`)
        return
      }
      const lockPath = getRuntimeLockPath()
      state.runtimeLockPath = lockPath
      const lease = await acquireRuntimeLease(lockPath, () => { void persistSnapshot() })
      if (!lease.acquired) { log('startup:background-disabled runtime_lease=busy'); return }
      runtimeLockOwner = true
      state.runtimeLeaseOwnerPid = lease.pid
      state.backgroundWorkerEnabled = true
      log(`startup:background-enabled context=${state.activationContext}`)

      if (!state.integrationSecret && cfg.autoHandshakeOnStart && cfg.knotworkBackendUrl && cfg.handshakeToken) {
        runHandshake(hCtx).catch((err: unknown) => {
          state.lastHandshakeOk = false
          state.lastHandshakeAt = new Date().toISOString()
          state.lastError = rememberError(err)
          log(`startup:handshake-failed ${state.lastError}`)
          if (isOperatorScopeError(err)) { log('startup:handshake-stopped reason=missing_required_operator_scope'); return }
          scheduleHandshakeRetry(hCtx, timerRef, 'startup_failed')
        })
      }
    })
    .catch((err: unknown) => {
      stateHydrated = true
      state.lastError = rememberError(err)
      log(`state:load-failed ${state.lastError}`)
    })

  const { port, token } = getGatewayConfig(api)
  log(`gateway: ws://127.0.0.1:${port}/ tokenPresent=${token !== null}`)

  let busy = false
  const pollMs = Math.max(500, cfg.taskPollIntervalMs ?? 2000)
  setInterval(() => {
    // integrationSecret guard: don't poll before handshake has completed.
    // The secret is set by runHandshake (on startup or via retry); polling activates naturally
    // once it arrives — no separate start mechanism needed.
    if (!state.backgroundWorkerEnabled || !state.integrationSecret || busy) return
    busy = true
    _pollAndRun(wCtx).catch((err) => log(`poll:error ${rememberError(err)}`)).finally(() => { busy = false })
  }, pollMs)

  const lockPath = () => state.runtimeLockPath ?? ''
  process.once('exit', () => { releaseRuntimeLeaseSync(lockPath(), runtimeLockOwner) })
  process.once('SIGINT', () => { void releaseRuntimeLease(lockPath(), runtimeLockOwner).finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void releaseRuntimeLease(lockPath(), runtimeLockOwner).finally(() => process.exit(0)) })
}

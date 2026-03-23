// plugin.ts — OpenClaw plugin entry point.
// Debug: openclaw gateway call knotwork.status | knotwork.logs | knotwork.handshake | knotwork.execute_task
// All log lines also written to stdout → `docker logs <container> | grep knotwork-bridge`

/* eslint-disable no-console */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getConfig, getGatewayConfig, pullTask, resolveInstanceId } from './openclaw/bridge'
import { runHandshake, scheduleHandshakeRetry, recoverCredentials as _recoverCredentials } from './lifecycle/handshake'
import type { TimerRef } from './lifecycle/handshake'
import { acquireRuntimeLease, releaseRuntimeLease, releaseRuntimeLeaseSync, renewRuntimeLease, LEASE_RENEW_INTERVAL_MS } from './state/lease'
import { readPersistedState, readPersistedCredentials } from './state/persist'
import { pollAndRun as _pollAndRun, runClaimedTask as _runClaimedTask, addRunningTask, removeRunningTask } from './lifecycle/worker'
import { registerRpcMethods } from './lifecycle/rpc'
import { isOperatorScopeError } from './openclaw/session'
import type { ExecutionTask, OpenClawApi, PluginState, RunningTaskInfo } from './types'

const PLUGIN_ID = 'knotwork-bridge'

// ── Activation state ─────────────────────────────────────────────────────────
// OpenClaw calls activate() once for the background runtime AND again for each
// `openclaw gateway call` invocation — all in the SAME Node.js process (shared
// module state). Each call needs its own api context so that registerGatewayMethod
// registers knotwork.* for that specific call's routing context. However only ONE
// poll loop should ever run.
//
// _rpcCtxFactory is set SYNCHRONOUSLY in the first activate() call (before any
// await), so it is immediately visible to any concurrent subsequent call. Any
// activate() call that sees _rpcCtxFactory != null takes the fast path:
// re-register RPC methods for the new api context and return without starting
// a second poll loop.
type RpcCtxFactory = (newApi: OpenClawApi) => Parameters<typeof registerRpcMethods>[0]
let _rpcCtxFactory: RpcCtxFactory | null = null
const STATE_FILE = 'knotwork-bridge-state.json'
// Lock and credentials live inside the plugin extension dir so `rm -rf extensions/knotwork-bridge` cleans them up.
const RUNTIME_LOCK_FILE = 'runtime.lock'
const CREDENTIALS_FILE = 'credentials.json'

// ── Gateway connection failure detection ─────────────────────────────────────
// Patterns that indicate the gateway process isn't listening yet (transient).
const GATEWAY_CONN_PATTERNS = [/cannot connect/i, /econnrefused/i, /gateway not available/i, /connection refused/i]

function isGatewayConnectionError(exitCode: number | null, output: string): boolean {
  if (exitCode === 0) return false
  return GATEWAY_CONN_PATTERNS.some((p) => p.test(output))
}

// ── Exponential backoff with jitter ──────────────────────────────────────────
// Returns the next delay in ms, capped at 60s. Jitter ±20%.
function backoffDelay(attempt: number): number {
  const base = Math.min(60_000, 2_000 * Math.pow(2, attempt))
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.round(base + jitter)
}

export function activate(api: OpenClawApi): void {
  // If a previous activate() has already set up state + handlers, re-register
  // RPC methods only for this api context and return. _rpcCtxFactory is set
  // synchronously below (before any await), so this guard fires immediately for
  // any concurrent or subsequent activate() call — avoiding a second poll loop.
  if (_rpcCtxFactory) {
    console.log(`[${PLUGIN_ID}] activate() called again — re-registering RPC methods for new call context`)
    registerRpcMethods(_rpcCtxFactory(api))
    return
  }

  let runtimeLockOwner = false
  let stateHydrated = false
  let snapshotWrite: Promise<void> = Promise.resolve()
  const timerRef: TimerRef = { current: null }

  const state: PluginState = {
    pluginInstanceId: null, integrationSecret: null, stateFilePath: null, runtimeLockPath: null,
    activationContext: null, backgroundWorkerEnabled: false, lastHandshakeAt: null,
    lastHandshakeOk: false, lastError: null, lastTaskAt: null,
    runningTaskId: null, runningTasks: [],
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
          recentTasks: state.recentTasks,
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

  // Store a factory so subsequent activate() calls (gateway call contexts) can re-register
  // RPC methods using their own api (required for registerGatewayMethod to bind to that
  // call's routing context) while reusing the shared state + handlers from this activation.
  _rpcCtxFactory = (callApi: OpenClawApi) => {
    // wCtx carries the runtime api — but subagent.run() requires the CURRENT gateway
    // request's api. Build a callCtx that replaces wCtx.api with callApi so that
    // runClaimedTask / pollAndRun pass the correct api to executeTask → subagent.run().
    const callCtx = { ...wCtx, api: callApi }
    return {
      api: callApi,
      state, log, rememberError,
      runHandshake: (overrides?: Partial<import('./openclaw/bridge').PluginConfig>) => runHandshake({ ...hCtx, api: callApi }, overrides),
      pollAndRun: () => _pollAndRun(callCtx),
      runClaimedTask: (task: ExecutionTask) => _runClaimedTask(callCtx, task),
      resetPersistedSecret,
    }
  }

  registerRpcMethods(_rpcCtxFactory(api))

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
      // Intentionally NOT restoring state.logs — each session starts with a fresh log buffer.
      // This ensures `knotwork.logs` always shows only the current session, not 200 lines of history
      // from previous restarts that would bury new entries.
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

  // ── Poll loop ─────────────────────────────────────────────────────────────────
  // Pull tasks directly over HTTP; only spawn a gateway call when there is actual work.
  // Multiple tasks can run concurrently up to MAX_CONCURRENT_TASKS.
  // subagent.run() requires a gateway request context → each task spawns its own
  // `openclaw gateway call knotwork.execute_task --params <task-json>`.
  // WS migration path: replace this setInterval+pullTask block with a WS listener
  // that pushes a pre-claimed task. The spawn logic below is identical.

  const MAX_CONCURRENT = (cfg as any).maxConcurrentTasks ?? 3
  const GATEWAY_RETRY_WINDOW_MS = (cfg as any).gatewayRetryWindowMs ?? 5 * 60 * 1000
  // Map from taskId → spawn info (for runningTasks state tracking).
  const activeSpawns = new Map<string, { startedAt: string }>()
  // Guard: only one 401-triggered re-handshake in flight at a time.
  let rehandshakeInProgress = false

  function lockPath(): string { return state.runtimeLockPath ?? '' }

  async function spawnExecuteTask(task: ExecutionTask, spawnContext: 'poll' | 'rpc'): Promise<void> {
    const taskId = String(task.task_id)
    const startedAt = new Date().toISOString()
    const taskInfo: RunningTaskInfo = {
      taskId,
      nodeId: task.node_id ? String(task.node_id) : null,
      runId: task.run_id ? String(task.run_id) : null,
      sessionName: task.session_name ? String(task.session_name) : null,
      startedAt,
      spawnContext,
    }
    addRunningTask(state, taskInfo)
    activeSpawns.set(taskId, { startedAt })
    log(`spawn:start id=${taskId} context=${spawnContext} concurrent=${activeSpawns.size}`)

    const retryWindowEnd = Date.now() + GATEWAY_RETRY_WINDOW_MS
    let attempt = 0

    const trySpawn = (): void => {
      const buf: Buffer[] = []
      const p = spawn('openclaw', ['gateway', 'call', 'knotwork.execute_task', '--params', JSON.stringify({ task })], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      p.stdout?.on('data', (d: Buffer) => buf.push(d))
      p.stderr?.on('data', (d: Buffer) => buf.push(d))

      p.on('close', (code) => {
        const output = Buffer.concat(buf).toString().trim()
        if (output) log(`spawn:output id=${taskId} attempt=${attempt} ${output.slice(0, 600)}`)

        if (isGatewayConnectionError(code, output)) {
          const remaining = retryWindowEnd - Date.now()
          if (remaining > 0) {
            const delay = backoffDelay(attempt)
            attempt += 1
            log(`spawn:gateway-unavailable id=${taskId} attempt=${attempt} retryIn=${delay}ms remaining=${Math.round(remaining / 1000)}s`)
            setTimeout(trySpawn, delay)
            return
          }
          // Exhausted retry window — report failure to Knotwork so the task can be rescheduled.
          log(`spawn:gateway-retry-exhausted id=${taskId} attempts=${attempt + 1}`)
          activeSpawns.delete(taskId)
          removeRunningTask(state, taskId)
          // Best-effort: post failed event over HTTP (doesn't need gateway).
          const baseUrl = getConfig(api).knotworkBackendUrl
          const instanceId = state.pluginInstanceId
          const secret = state.integrationSecret
          if (baseUrl && instanceId && secret) {
            import('../openclaw/bridge').then(({ postEvent }) => {
              postEvent(baseUrl, instanceId, secret, taskId, 'failed', { error: 'gateway_unavailable: retry window exhausted' })
                .catch((err: unknown) => { log(`spawn:failed-event-error id=${taskId} ${err instanceof Error ? err.message : String(err)}`) })
            }).catch(() => {})
          }
          return
        }

        // Normal close (success or non-gateway error).
        activeSpawns.delete(taskId)
        removeRunningTask(state, taskId)
        if (code !== 0) {
          log(`spawn:exit-nonzero id=${taskId} code=${code}`)
        } else {
          log(`spawn:done id=${taskId} concurrent=${activeSpawns.size}`)
        }
      })

      p.on('error', (e: Error) => {
        log(`spawn:error id=${taskId} ${e.message}`)
        activeSpawns.delete(taskId)
        removeRunningTask(state, taskId)
      })
    }

    trySpawn()
  }

  const pollMs = Math.max(500, cfg.taskPollIntervalMs ?? 2000)

  // .unref() on all intervals: prevents timers from keeping the subprocess alive after
  // the gateway call completes. Without this, spawned subprocesses never exit (Node.js
  // event loop stays open), filling activeSpawns to MAX_CONCURRENT and blocking the pool.
  setInterval(() => {
    if (!state.backgroundWorkerEnabled || !state.integrationSecret) return
    if (activeSpawns.size >= MAX_CONCURRENT) return  // at capacity
    const baseUrl = getConfig(api).knotworkBackendUrl
    const instanceId = state.pluginInstanceId
    const secret = state.integrationSecret
    if (!baseUrl || !instanceId || !secret) return

    void (async () => {
      try {
        // pullTask acts as the heartbeat (updates last_seen_at on the backend).
        // Capacity is reported so the backend always knows the real running count.
        const capacity = { tasksRunning: activeSpawns.size, slotsAvailable: Math.max(0, MAX_CONCURRENT - activeSpawns.size) }
        const task = await pullTask(baseUrl, instanceId, secret, capacity)
        if (!task) return  // no pending work; heartbeat still sent
        void spawnExecuteTask(task, 'poll')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`poll:error ${msg}`)
        // 401 = integrationSecret rejected (plugin re-installed, DB wiped, etc.)
        // Clear the stale secret so the poll guard (!integrationSecret) stops the
        // flood immediately, then trigger a full re-handshake with the config token.
        if (/\(401\)|invalid plugin credentials/i.test(msg)) {
          if (rehandshakeInProgress) return  // another poll tick already handling this
          rehandshakeInProgress = true
          log('poll:credentials-rejected clearing_secret=true triggering_rehandshake=true')
          state.integrationSecret = null
          void persistCredentials()  // wipe from disk — restart will also re-handshake
          void recoverCredentials('poll_401').finally(() => { rehandshakeInProgress = false })
        }
      }
    })()
  }, pollMs).unref()

  // ── Lease renewal ─────────────────────────────────────────────────────────────
  setInterval(() => {
    void renewRuntimeLease(lockPath(), runtimeLockOwner)
  }, LEASE_RENEW_INTERVAL_MS).unref()

  // ── Spawn TTL watchdog ─────────────────────────────────────────────────────────
  // If a subprocess never fires its 'close' event (hung process), its entry stays in
  // activeSpawns forever, permanently blocking the pool once MAX_CONCURRENT is reached.
  // This watchdog evicts entries older than SPAWN_TTL_MS so the pool self-heals.
  const SPAWN_TTL_MS = (cfg as any).spawnTtlMs ?? 2 * 60 * 60 * 1000  // default: 2 hours
  setInterval(() => {
    const now = Date.now()
    for (const [id, info] of activeSpawns.entries()) {
      const age = now - new Date(info.startedAt).getTime()
      if (age > SPAWN_TTL_MS) {
        log(`spawn:ttl-evict id=${id} age=${Math.round(age / 60000)}m — subprocess never exited, evicting from pool`)
        activeSpawns.delete(id)
        removeRunningTask(state, id)
      }
    }
  }, 60_000).unref()  // check every minute

  // ── Graceful shutdown ─────────────────────────────────────────────────────────
  process.once('exit', () => { releaseRuntimeLeaseSync(lockPath(), runtimeLockOwner) })
  process.once('SIGINT', () => { void releaseRuntimeLease(lockPath(), runtimeLockOwner).finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void releaseRuntimeLease(lockPath(), runtimeLockOwner).finally(() => process.exit(0)) })
}

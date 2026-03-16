// plugin.ts — OpenClaw plugin entry point.
// Debug: openclaw gateway call knotwork.status | knotwork.logs | knotwork.handshake | knotwork.process_once
// All log lines also written to stdout → `docker logs <container> | grep knotwork-bridge`

/* eslint-disable no-console */
import { rmSync } from 'node:fs'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { discoverAgents, doHandshake, getConfig, getGatewayConfig, postEvent, pullTask, resolveInstanceId } from './bridge'
import { executeTask, isOperatorScopeError, verifyGatewayOperatorScopes } from './session'
import type { AnyObj, OpenClawApi, PluginConfig, PluginState, RecentTask } from './types'

const PLUGIN_ID = 'knotwork-bridge'
const STATE_FILE = 'knotwork-bridge-state.json'
const RUNTIME_LOCK_FILE = 'knotwork-bridge-runtime.lock'
const HANDSHAKE_RETRY_MS = 15000

type PersistedPluginState = {
  pluginInstanceId?: string
  integrationSecret?: string
  lastHandshakeAt?: string
  lastHandshakeOk?: boolean
  lastError?: string | null
  lastTaskAt?: string | null
  runtimeLockPath?: string | null
  runtimeLeaseOwnerPid?: number | null
  recentTasks?: RecentTask[]
  logs?: string[]
}

const MAX_RECENT_TASKS = 20

export function activate(api: OpenClawApi): void {
  let runtimeLockOwner = false
  let stateHydrated = false
  const state: PluginState = {
    pluginInstanceId: null,
    integrationSecret: null,
    stateFilePath: null,
    runtimeLockPath: null,
    activationContext: null,
    backgroundWorkerEnabled: false,
    lastHandshakeAt: null,
    lastHandshakeOk: false,
    lastError: null,
    lastTaskAt: null,
    runningTaskId: null,
    runtimeLeaseOwnerPid: null,
    recentTasks: [],
    logs: [],
  }

  // ── Logging ─────────────────────────────────────────────────────────────────
  // Each line goes to: stdout (Docker-visible) + in-memory ring buffer (RPC-accessible)

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

  function upsertRecentTask(task: RecentTask): void {
    const rest = state.recentTasks.filter((item) => item.taskId !== task.taskId)
    state.recentTasks = [task, ...rest].slice(0, MAX_RECENT_TASKS)
    void persistSnapshot()
  }

  function currentRecentTask(task: AnyObj, taskId: string, startedAt: string): RecentTask {
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

  function getStateFilePath(): string {
    const home = getHomeDir()
    return join(home, '.openclaw', STATE_FILE)
  }

  function getRuntimeLockPath(): string {
    const home = getHomeDir()
    return join(home, '.openclaw', RUNTIME_LOCK_FILE)
  }

  function getHomeDir(): string {
    const home = (() => {
      try { return homedir() } catch { return process?.env?.HOME || '.' }
    })()
    return home
  }

  function getProcessArgs(): string[] {
    try {
      return Array.isArray(process?.argv) ? process.argv.map((part) => String(part).toLowerCase()) : []
    } catch {
      return []
    }
  }

  function detectActivationContext(): string {
    const args = getProcessArgs()
    if (args.includes('gateway') && args.includes('call')) return 'cli_gateway_call'
    if (args.includes('plugins') && (args.includes('list') || args.includes('inspect'))) return 'cli_plugins'
    if (args.includes('--help') || args.includes('-h')) return 'cli_help'
    return 'runtime'
  }

  async function readPersistedState(): Promise<PersistedPluginState> {
    const path = getStateFilePath()
    state.stateFilePath = path
    try {
      const raw = await readFile(path, 'utf8')
      const parsed = JSON.parse(raw) as PersistedPluginState
      return {
        pluginInstanceId: typeof parsed.pluginInstanceId === 'string' ? parsed.pluginInstanceId.trim() : undefined,
        integrationSecret: typeof parsed.integrationSecret === 'string' ? parsed.integrationSecret.trim() : undefined,
        lastHandshakeAt: typeof parsed.lastHandshakeAt === 'string' ? parsed.lastHandshakeAt : undefined,
        lastHandshakeOk: typeof parsed.lastHandshakeOk === 'boolean' ? parsed.lastHandshakeOk : undefined,
        lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
        lastTaskAt: typeof parsed.lastTaskAt === 'string' ? parsed.lastTaskAt : null,
        runtimeLockPath: typeof parsed.runtimeLockPath === 'string' ? parsed.runtimeLockPath : null,
        runtimeLeaseOwnerPid: Number.isInteger(parsed.runtimeLeaseOwnerPid) ? parsed.runtimeLeaseOwnerPid : null,
        recentTasks: Array.isArray(parsed.recentTasks) ? parsed.recentTasks.slice(0, MAX_RECENT_TASKS) : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-200).filter((line): line is string => typeof line === 'string') : [],
      }
    } catch {
      return {}
    }
  }

  let snapshotWrite: Promise<void> = Promise.resolve()

  async function persistSnapshot(): Promise<void> {
    const path = state.stateFilePath ?? getStateFilePath()
    state.stateFilePath = path
    snapshotWrite = snapshotWrite
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify({
          pluginInstanceId: state.pluginInstanceId,
          integrationSecret: state.integrationSecret,
          lastHandshakeAt: state.lastHandshakeAt,
          lastHandshakeOk: state.lastHandshakeOk,
          lastError: state.lastError,
          lastTaskAt: state.lastTaskAt,
          runtimeLockPath: state.runtimeLockPath,
          runtimeLeaseOwnerPid: state.runtimeLeaseOwnerPid,
          recentTasks: state.recentTasks,
          logs: state.logs,
        }, null, 2))
      })
    return snapshotWrite
  }

  async function persistState(): Promise<void> {
    await persistSnapshot()
  }

  async function releaseRuntimeLease(): Promise<void> {
    if (!runtimeLockOwner || !state.runtimeLockPath) return
    runtimeLockOwner = false
    try {
      await rm(state.runtimeLockPath, { force: true })
    } catch {
      // ignore cleanup failures
    }
  }

  function releaseRuntimeLeaseSync(): void {
    if (!runtimeLockOwner || !state.runtimeLockPath) return
    runtimeLockOwner = false
    try {
      rmSync(state.runtimeLockPath, { force: true })
    } catch {
      // ignore cleanup failures
    }
  }

  function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  async function acquireRuntimeLease(): Promise<boolean> {
    const path = getRuntimeLockPath()
    state.runtimeLockPath = path
    await mkdir(dirname(path), { recursive: true })

    const tryAcquire = async (): Promise<boolean> => {
      try {
        const handle = await open(path, 'wx')
        await handle.writeFile(JSON.stringify({
          pid: process?.pid ?? null,
          acquired_at: new Date().toISOString(),
          plugin_id: PLUGIN_ID,
        }, null, 2))
        runtimeLockOwner = true
        state.runtimeLeaseOwnerPid = process?.pid ?? null
        await handle.close()
        void persistSnapshot()
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!/exist/i.test(msg)) return false
        try {
          const raw = await readFile(path, 'utf8')
          const parsed = JSON.parse(raw) as { pid?: number }
          if (!isProcessAlive(Number(parsed.pid ?? 0))) {
            await rm(path, { force: true })
            return tryAcquire()
          }
        } catch {
          await rm(path, { force: true })
          return tryAcquire()
        }
        return false
      }
    }

    return tryAcquire()
  }

  async function resetPersistedSecret(resetInstanceId = false): Promise<void> {
    if (resetInstanceId) state.pluginInstanceId = null
    state.integrationSecret = null
    await persistState()
  }

  function isInvalidCredentialsError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err)
    return /invalid plugin credentials/i.test(msg) || /\(401\)/.test(msg)
  }

  let handshakeRetryTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleHandshakeRetry(reason: string): void {
    if (handshakeRetryTimer) return
    handshakeRetryTimer = setTimeout(() => {
      handshakeRetryTimer = null
      runHandshake().catch((err: unknown) => {
        state.lastHandshakeOk = false
        state.lastHandshakeAt = new Date().toISOString()
        state.lastError = rememberError(err)
        log(`handshake:retry-failed reason=${reason} error=${state.lastError}`)
        if (isOperatorScopeError(err)) {
          log('handshake:retry-stopped reason=missing_required_operator_scope')
          return
        }
        scheduleHandshakeRetry('retry_failed')
      })
    }, HANDSHAKE_RETRY_MS)
  }

  // ── Handshake ────────────────────────────────────────────────────────────────

  async function runHandshake(overrides: Partial<PluginConfig> = {}): Promise<AnyObj> {
    const cfg = { ...getConfig(api), ...overrides }
    if (!cfg.knotworkBackendUrl || !cfg.handshakeToken) {
      throw new Error('Missing knotworkBackendUrl or handshakeToken in plugin config')
    }
    const instanceId = state.pluginInstanceId ?? resolveInstanceId(cfg)
    await verifyGatewayOperatorScopes(api)
    const agents = await discoverAgents(api)
    log(`handshake:start instanceId=${instanceId} agents=${agents.length}`)
    const resp = await doHandshake(cfg.knotworkBackendUrl, cfg.handshakeToken, instanceId, agents)
    state.pluginInstanceId = (resp.plugin_instance_id as string | undefined) ?? instanceId
    state.integrationSecret = (resp.integration_secret as string | undefined) ?? state.integrationSecret
    await persistState()
    state.lastHandshakeOk = true
    state.lastHandshakeAt = new Date().toISOString()
    state.lastError = null
    log(`handshake:ok secret=...${String(state.integrationSecret ?? '').slice(-4)} instanceId=${state.pluginInstanceId}`)
    return resp
  }

  async function recoverCredentials(reason: string): Promise<boolean> {
    const cfg = getConfig(api)
    if (!cfg.knotworkBackendUrl || !cfg.handshakeToken) {
      log(`handshake:skipped reason=${reason} missing_config=true`)
      return false
    }
    try {
      await runHandshake()
      log(`handshake:recovered reason=${reason}`)
      return true
    } catch (err) {
      state.lastHandshakeOk = false
      state.lastHandshakeAt = new Date().toISOString()
      state.lastError = rememberError(err)
      log(`handshake:recover-failed reason=${reason} error=${state.lastError}`)
      if (isOperatorScopeError(err)) {
        log('handshake:recover-stopped reason=missing_required_operator_scope')
        return false
      }
      scheduleHandshakeRetry('recover_failed')
      return false
    }
  }

  // ── Task execution ───────────────────────────────────────────────────────────

  async function pollAndRun(): Promise<void> {
    const cfg = getConfig(api)
    const baseUrl = cfg.knotworkBackendUrl
    const instanceId = state.pluginInstanceId
    const secret = state.integrationSecret
    if (!baseUrl || !instanceId || !secret) {
      const missing = [
        !baseUrl ? 'knotworkBackendUrl' : null,
        !instanceId ? 'pluginInstanceId' : null,
        !secret ? 'integrationSecret' : null,
      ].filter(Boolean).join(',')
      log(`poll:skipped missing=${missing}`)
      return
    }

    let task: AnyObj | null = null
    log(`pull:start instanceId=${instanceId}`)
    try {
      task = await pullTask(baseUrl, instanceId, secret)
    } catch (err) {
      if (!isInvalidCredentialsError(err)) {
        const error = rememberError(err)
        log(`pull:error instanceId=${instanceId} error=${error}`)
        throw err
      }
      log('auth:pull-task-invalid-credentials')
      await resetPersistedSecret()
      const recovered = await recoverCredentials('pull_task_401')
      if (!recovered || !state.integrationSecret || !state.pluginInstanceId) return
      log(`pull:retry instanceId=${state.pluginInstanceId}`)
      task = await pullTask(baseUrl, state.pluginInstanceId, state.integrationSecret)
    }
    if (!task) {
      log(`pull:empty instanceId=${instanceId}`)
      return
    }

    const taskId = String(task.task_id)
    const taskStartedAt = new Date().toISOString()
    state.runningTaskId = taskId
    state.lastTaskAt = taskStartedAt
    upsertRecentTask({
      ...currentRecentTask(task, taskId, taskStartedAt),
      status: 'claimed',
      finishedAt: null,
      error: null,
    })
    log(`task:start id=${taskId} node=${task.node_id} run=${task.run_id ?? 'n/a'} session=${task.session_name}`)

    async function submitEvent(eventType: string, payload: AnyObj): Promise<void> {
      const curInstanceId = state.pluginInstanceId
      const curSecret = state.integrationSecret
      if (!baseUrl || !curInstanceId || !curSecret) {
        throw new Error(`Cannot submit ${eventType}: plugin credentials unavailable`)
      }
      log(`event:post:start id=${taskId} type=${eventType}`)
      try {
        await postEvent(baseUrl, curInstanceId, curSecret, taskId, eventType, payload)
        log(`event:post:ok id=${taskId} type=${eventType}`)
      } catch (err) {
        if (!isInvalidCredentialsError(err)) {
          const error = rememberError(err)
          log(`event:post:error id=${taskId} type=${eventType} error=${error}`)
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

    // Notify Knotwork we've claimed the task (visible in debug panel)
    await submitEvent('log', {
      entry_type: 'action',
      content: 'Plugin started task execution',
      metadata: { node_id: task.node_id, run_id: task.run_id, session_name: task.session_name },
    }).catch((err) => {
      const error = rememberError(err)
      log(`event:post:nonfatal id=${taskId} type=log error=${error}`)
    })

    let heartbeat: ReturnType<typeof setInterval> | null = null
    try {
      let heartbeatCount = 0
      heartbeat = setInterval(() => {
        heartbeatCount += 1
        submitEvent('log', {
          entry_type: 'progress',
          content: `OpenClaw is still working (heartbeat ${heartbeatCount})`,
          metadata: { heartbeat: heartbeatCount, node_id: task.node_id, run_id: task.run_id },
        }).catch(() => { /* non-fatal heartbeat */ })
      }, 15000)

      const result = await executeTask(api, task)
      if (heartbeat) clearInterval(heartbeat)
      log(`task:done id=${taskId} type=${result.type}`)

      if (result.type === 'escalation') {
        upsertRecentTask({
          ...currentRecentTask(task, taskId, taskStartedAt),
          status: 'escalation',
          finishedAt: new Date().toISOString(),
          error: null,
        })
        await submitEvent('escalation', {
          question: result.question,
          options: result.options,
          message: result.message,
        })
      } else if (result.type === 'failed') {
        upsertRecentTask({
          ...currentRecentTask(task, taskId, taskStartedAt),
          status: 'failed',
          finishedAt: new Date().toISOString(),
          error: result.error,
        })
        await submitEvent('failed', { error: result.error })
      } else {
        upsertRecentTask({
          ...currentRecentTask(task, taskId, taskStartedAt),
          status: 'completed',
          finishedAt: new Date().toISOString(),
          error: null,
        })
        await submitEvent('completed', {
          output: result.output,
          next_branch: result.next_branch,
        })
      }
    } catch (err) {
      const error = rememberError(err)
      upsertRecentTask({
        ...currentRecentTask(task, taskId, taskStartedAt),
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error,
      })
      log(`task:error id=${taskId} ${error}`)
      await submitEvent('failed', { error }).catch((submitErr) => {
        const submitError = rememberError(submitErr)
        log(`task:error-report-failed id=${taskId} error=${submitError}`)
      })
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      state.runningTaskId = null
      void persistSnapshot()
    }
  }

  // ── Gateway RPC methods ───────────────────────────────────────────────────────
  // These are callable from any terminal: `openclaw gateway call knotwork.<method>`

  if (typeof api.registerGatewayMethod === 'function') {
    const rpc = api.registerGatewayMethod.bind(api)

    rpc('knotwork.status', async (ctx: AnyObj) => {
      const cfg = getConfig(api)
      ok(ctx, {
        ...state,
        runtime: {
          gatewayCallAvailable: typeof api.gateway?.call === 'function',
          runtimeLeaseOwnerPid: state.runtimeLeaseOwnerPid,
          currentPid: process?.pid ?? null,
        },
        config: {
          knotworkBackendUrl: cfg.knotworkBackendUrl ?? null,
          autoHandshakeOnStart: cfg.autoHandshakeOnStart ?? true,
          taskPollIntervalMs: cfg.taskPollIntervalMs ?? 2000,
        },
      })
    })

    rpc('knotwork.logs', async (ctx: AnyObj) => {
      ok(ctx, {
        logs: state.logs,
        count: state.logs.length,
        recentTasks: state.recentTasks,
      })
    })

    const handleHandshake = async (ctx: AnyObj): Promise<void> => {
      const payload = getPayload(ctx)
      try {
        const resp = await runHandshake({
          knotworkBackendUrl: payload.knotworkBackendUrl as string | undefined,
          handshakeToken: payload.handshakeToken as string | undefined,
          pluginInstanceId: payload.pluginInstanceId as string | undefined,
        })
        ok(ctx, { ok: true, pluginInstanceId: state.pluginInstanceId, result: resp })
      } catch (err) {
        const error = rememberError(err)
        state.lastHandshakeOk = false
        state.lastHandshakeAt = new Date().toISOString()
        log(`handshake:error ${error}`)
        ok(ctx, { ok: false, error })
      }
    }

    rpc('knotwork.handshake', handleHandshake)
    rpc('knotwork.sync_agents', handleHandshake) // alias — re-handshake re-syncs agents

    rpc('knotwork.process_once', async (ctx: AnyObj) => {
      try {
        await pollAndRun()
        ok(ctx, { ok: true })
      } catch (err) {
        const error = rememberError(err)
        log(`process_once:error ${error}`)
        ok(ctx, { ok: false, error })
      }
    })

    rpc('knotwork.reset_connection', async (ctx: AnyObj) => {
      const payload = getPayload(ctx)
      const resetInstanceId = payload.resetInstanceId === true
      await resetPersistedSecret(resetInstanceId)
      state.lastError = null
      state.lastHandshakeOk = false
      state.recentTasks = []
      state.logs = []
      log(`connection:reset resetInstanceId=${resetInstanceId}`)
      ok(ctx, {
        ok: true,
        pluginInstanceId: state.pluginInstanceId,
        resetInstanceId,
        stateFilePath: state.stateFilePath,
      })
    })
  }

  // ── Startup ───────────────────────────────────────────────────────────────────

  const cfg = getConfig(api)
  state.activationContext = detectActivationContext()
  readPersistedState()
    .then(async (persisted) => {
      const configuredInstanceId = cfg.pluginInstanceId?.trim() || null
      const effectiveInstanceId = configuredInstanceId || persisted.pluginInstanceId || resolveInstanceId(cfg)
      state.pluginInstanceId = effectiveInstanceId
      if (persisted.integrationSecret && (!configuredInstanceId || configuredInstanceId === persisted.pluginInstanceId)) {
        state.integrationSecret = persisted.integrationSecret
        log(`state:loaded secret=...${persisted.integrationSecret.slice(-4)}`)
      } else if (persisted.integrationSecret && configuredInstanceId && configuredInstanceId !== persisted.pluginInstanceId) {
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
      await persistState()

      const canStartBackground = state.activationContext === 'runtime'
      if (!canStartBackground) {
        log(`startup:background-disabled context=${state.activationContext}`)
        return
      }
      const leased = await acquireRuntimeLease()
      if (!leased) {
        log('startup:background-disabled runtime_lease=busy')
        return
      }
      state.backgroundWorkerEnabled = true
      log(`startup:background-enabled context=${state.activationContext}`)

      if (!state.integrationSecret && cfg.autoHandshakeOnStart && cfg.knotworkBackendUrl && cfg.handshakeToken) {
        runHandshake().catch((err: unknown) => {
          state.lastHandshakeOk = false
          state.lastHandshakeAt = new Date().toISOString()
          state.lastError = rememberError(err)
          log(`startup:handshake-failed ${state.lastError}`)
          if (isOperatorScopeError(err)) {
            log('startup:handshake-stopped reason=missing_required_operator_scope')
            return
          }
          scheduleHandshakeRetry('startup_failed')
        })
      }
    })
    .catch((err: unknown) => {
      stateHydrated = true
      state.lastError = rememberError(err)
      log(`state:load-failed ${state.lastError}`)
    })

  // Startup diagnostic — confirm WebSocket gateway config is readable
  const { port, token } = getGatewayConfig(api)
  log(`gateway: ws://127.0.0.1:${port}/ tokenPresent=${token !== null}`)

  // Poll loop — busy flag prevents concurrent execution
  let busy = false
  const pollMs = Math.max(500, cfg.taskPollIntervalMs ?? 2000)
  setInterval(() => {
    if (!state.backgroundWorkerEnabled) return
    if (busy) return
    busy = true
    pollAndRun()
      .catch((err) => log(`poll:error ${rememberError(err)}`))
      .finally(() => { busy = false })
  }, pollMs)

  process.once('exit', () => {
    releaseRuntimeLeaseSync()
  })
  process.once('SIGINT', () => {
    void releaseRuntimeLease().finally(() => process.exit(0))
  })
  process.once('SIGTERM', () => {
    void releaseRuntimeLease().finally(() => process.exit(0))
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPayload(ctx: AnyObj): AnyObj {
  return (ctx.request?.payload ?? ctx.payload ?? {}) as AnyObj
}

function ok(ctx: AnyObj, payload: AnyObj): void {
  if (typeof ctx.respond === 'function') ctx.respond(true, payload)
}

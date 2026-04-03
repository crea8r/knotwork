// rpc.ts — Gateway RPC method registrations (knotwork.* methods).
// Callable from any terminal: `openclaw gateway call knotwork.<method>`

import { join } from 'node:path'
import { getConfig } from '../openclaw/bridge'
import { getPublicKeyB64 } from './auth'
import { createTaskLogger } from '../state/tasklog'
import { runClaimedTask as _runClaimedTask } from './worker'
import type { ExecutionTask, GatewayMethodContext, LooseRecord, OpenClawApi, PluginConfig, PluginState, SubprocessParams } from '../types'

export type RpcCtx = {
  state: PluginState
  api: OpenClawApi
  log: (msg: string) => void
  rememberError: (err: unknown) => string
  runAuth: () => Promise<void>
  pollAndRun: () => Promise<void>
  runClaimedTask: (task: ExecutionTask) => Promise<void>
  resetAuth: () => Promise<void>
  /** Absolute path where runtime.lock will be written — derived from __dirname in plugin.ts */
  computedLockPath: string
}

function getPayload(ctx: GatewayMethodContext): LooseRecord {
  return (ctx.params ?? {}) as LooseRecord
}

function ok(ctx: GatewayMethodContext, payload: LooseRecord): void {
  ctx.respond(true, payload)
}

export function registerRpcMethods(ctx: RpcCtx): void {
  const { api, state, log, rememberError, runAuth, pollAndRun, runClaimedTask, resetAuth, computedLockPath } = ctx
  const apiKeys = Object.keys(api as object).join(',')
  if (typeof api.registerGatewayMethod !== 'function') {
    console.log(`[knotwork-bridge] rpc:register-skipped registerGatewayMethod not a function — api keys: ${apiKeys}`)
    return
  }
  const rpc = api.registerGatewayMethod.bind(api)

  rpc('knotwork.status', (gwCtx: GatewayMethodContext) => {
    const cfg = getConfig(api)
    const rawPluginConfig = (api as any).pluginConfig ?? null
    const rawConfigEntries = (api as any).config?.plugins?.entries ?? null
    const runningTasks = Array.isArray(state.runningTasks) ? state.runningTasks : []
    const pendingTasks = Array.isArray(state.recentTasks)
      ? state.recentTasks.filter((t) => t.status !== 'completed' && t.status !== 'failed')
      : []
    ok(gwCtx, {
      ...state,
      // Redact JWT from status output — show only expiry
      jwt: state.jwt ? `...${state.jwt.slice(-8)}` : null,
      runningCount: runningTasks.length,
      runningTasks,
      pendingTasks,
      runtime: {
        runtimeLeaseOwnerPid: state.runtimeLeaseOwnerPid,
        currentPid: process?.pid ?? null,
      },
      config: {
        knotworkBackendUrl: cfg.knotworkBackendUrl ?? null,
        workspaceId: cfg.workspaceId ?? null,
        privateKeyPath: cfg.privateKeyPath ? '(set)' : null,
        autoAuthOnStart: cfg.autoAuthOnStart ?? true,
        taskPollIntervalMs: cfg.taskPollIntervalMs ?? 30000,
      },
      _debug: { rawPluginConfig, rawConfigEntries },
      diag: {
        activationContext: state.activationContext,
        backgroundWorkerEnabled: state.backgroundWorkerEnabled,
        computedLockPath,
        runtimeLockPath: state.runtimeLockPath,
        leaseOwnerPid: state.runtimeLeaseOwnerPid,
        currentPid: process?.pid ?? null,
        isLeaseOwner: state.runtimeLeaseOwnerPid === (process?.pid ?? null),
      },
    })
  })

  rpc('knotwork.logs', async (gwCtx: GatewayMethodContext) => {
    ok(gwCtx, { logs: state.logs, count: state.logs.length })
  })

  rpc('knotwork.task_history', async (gwCtx: GatewayMethodContext) => {
    ok(gwCtx, { recentTasks: state.recentTasks, count: state.recentTasks.length })
  })

  rpc('knotwork.clear_log', (_gwCtx: GatewayMethodContext) => {
    const count = state.logs.length
    // Mutate in-place so any existing reference to the array also sees the clear.
    state.logs.splice(0, state.logs.length)
    // Write to console only — calling log() would immediately add an entry back.
    console.log(`[knotwork-bridge] logs:cleared count=${count}`)
    ok(_gwCtx, { ok: true, cleared: count })
  })

  rpc('knotwork.get_public_key', (gwCtx: GatewayMethodContext) => {
    const cfg = getConfig(api)
    if (!cfg.privateKeyPath) {
      ok(gwCtx, { ok: false, error: 'privateKeyPath not configured' })
      return
    }
    try {
      const publicKey = getPublicKeyB64(cfg.privateKeyPath)
      ok(gwCtx, { ok: true, publicKey })
    } catch (err) {
      ok(gwCtx, { ok: false, error: rememberError(err) })
    }
  })

  const handleAuth = async (gwCtx: GatewayMethodContext): Promise<void> => {
    const cfg = getConfig(api)
    log(`auth:debug url=${cfg.knotworkBackendUrl ?? 'MISSING'} privateKeyPath=${cfg.privateKeyPath ? 'set' : 'MISSING'}`)
    try {
      await runAuth()
      ok(gwCtx, { ok: true, pluginInstanceId: state.pluginInstanceId, jwtExpiresAt: state.jwtExpiresAt })
    } catch (err) {
      const error = rememberError(err)
      state.lastAuthOk = false
      state.lastAuthAt = new Date().toISOString()
      log(`auth:error ${error}`)
      ok(gwCtx, { ok: false, error })
    }
  }

  rpc('knotwork.auth', handleAuth)
  rpc('knotwork.handshake', handleAuth) // backward-compat alias

  // Execute a task inside a gateway request context (required for subagent.run()).
  // Primary path: subprocess passes full SubprocessParams { task, pluginInstanceId, jwt, workspaceId, knotworkUrl, taskLogPath }.
  // Fallback path: no task in params → full poll-then-run cycle.
  //
  // NOTE: ok() must be called AFTER awaiting the task — subagent.run() is bound to the
  // gateway request context (gwCtx). Calling ok() first terminates that context and
  // subagent.run() fails immediately with no task:start logged.
  const handleExecuteTask = async (gwCtx: GatewayMethodContext): Promise<void> => {
    const payload = getPayload(gwCtx)
    const preClaimedTask = (payload.task ?? null) as ExecutionTask | null
    const subagentKeys = Object.keys((((api as any).runtime ?? {}) as LooseRecord).subagent ?? {}).join(',')
    log(`execute_task:start taskId=${String(preClaimedTask?.task_id ?? 'poll')} hasTask=${Boolean(preClaimedTask)} subagentKeys=${subagentKeys || 'none'} pid=${process?.pid ?? 'unknown'}`)
    try {
      let recentTask: unknown = null
      if (preClaimedTask) {
        const hasSubprocessCreds =
          typeof payload.pluginInstanceId === 'string' &&
          typeof payload.jwt === 'string' &&
          typeof payload.workspaceId === 'string' &&
          typeof payload.knotworkUrl === 'string'

        if (hasSubprocessCreds) {
          const sp = payload as unknown as SubprocessParams
          const taskLogPath = typeof sp.taskLogPath === 'string' ? sp.taskLogPath : undefined
          const taskLog = createTaskLogger(taskLogPath ?? join(__dirname, 'tasks.log'))
          taskLog('execute_task:start', String(preClaimedTask.task_id ?? 'unknown'), {
            hasTask: 'true',
            subagentKeys: subagentKeys || 'none',
            pid: String(process?.pid ?? 'unknown'),
            session: String(preClaimedTask.session_name ?? ''),
          })
          // Build a minimal ctx — state fields are unused when creds are explicit.
          const minimalCtx = {
            state: {
              pluginInstanceId: sp.pluginInstanceId,
              jwt: sp.jwt, jwtExpiresAt: null,
              guideContent: null, guideVersion: null,
              stateFilePath: null, runtimeLockPath: null, activationContext: 'cli_gateway_call',
              backgroundWorkerEnabled: false, lastAuthAt: null, lastAuthOk: false,
              lastError: null, lastTaskAt: null, runningTaskId: null, runningTasks: [],
              runtimeLeaseOwnerPid: null, recentTasks: [], logs: [],
            },
            api, log, rememberError,
            persistSnapshot: async () => { /* no-op: subprocess does not persist */ },
            resetAuth: async () => { /* no-op */ },
            recoverAuth: async () => false,
            taskLog,
          }
          recentTask = await _runClaimedTask(minimalCtx, preClaimedTask, {
            pluginInstanceId: sp.pluginInstanceId,
            jwt: sp.jwt,
            workspaceId: sp.workspaceId,
            knotworkUrl: sp.knotworkUrl,
          })
        } else {
          // Legacy path: credentials come from state (same-process runtime call).
          recentTask = await runClaimedTask(preClaimedTask)
        }
      } else {
        await pollAndRun()
      }
      ok(gwCtx, { ok: true, recentTask })
    } catch (err) {
      const error = rememberError(err)
      log(`execute_task:error taskId=${String(preClaimedTask?.task_id ?? 'poll')} ${error}`)
      ok(gwCtx, { ok: false, error })
    }
  }
  rpc('knotwork.execute_task', handleExecuteTask)
  rpc('knotwork.process_once', handleExecuteTask) // backward-compat alias

  rpc('knotwork.reset_connection', async (gwCtx: GatewayMethodContext) => {
    await resetAuth()
    state.lastError = null
    state.lastAuthOk = false
    state.recentTasks = []
    state.logs = []
    log('connection:reset')
    ok(gwCtx, { ok: true, pluginInstanceId: state.pluginInstanceId, stateFilePath: state.stateFilePath })
  })
}

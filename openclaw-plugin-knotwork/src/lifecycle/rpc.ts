// rpc.ts — Gateway RPC method registrations (knotwork.* methods).
// Callable from any terminal: `openclaw gateway call knotwork.<method>`

import { getConfig } from '../openclaw/bridge'
import type { ExecutionTask, GatewayMethodContext, HandshakeResponse, LooseRecord, OpenClawApi, PluginConfig, PluginState } from '../types'

export type RpcCtx = {
  state: PluginState
  api: OpenClawApi
  log: (msg: string) => void
  rememberError: (err: unknown) => string
  runHandshake: (overrides?: Partial<PluginConfig>) => Promise<HandshakeResponse>
  pollAndRun: () => Promise<void>
  runClaimedTask: (task: ExecutionTask) => Promise<void>
  resetPersistedSecret: (resetInstanceId?: boolean) => Promise<void>
}

function getPayload(ctx: GatewayMethodContext): LooseRecord {
  return (ctx.params ?? {}) as LooseRecord
}

function ok(ctx: GatewayMethodContext, payload: LooseRecord): void {
  ctx.respond(true, payload)
}

export function registerRpcMethods(ctx: RpcCtx): void {
  const { api, state, log, rememberError, runHandshake, pollAndRun, runClaimedTask, resetPersistedSecret } = ctx
  const apiKeys = Object.keys(api as object).join(',')
  if (typeof api.registerGatewayMethod !== 'function') {
    console.log(`[knotwork-bridge] rpc:register-skipped registerGatewayMethod not a function — api keys: ${apiKeys}`)
    return
  }
  console.log(`[knotwork-bridge] rpc:registering-methods api-keys=${apiKeys}`)
  const rpc = api.registerGatewayMethod.bind(api)

  rpc('knotwork.status', (gwCtx: GatewayMethodContext) => {
    const cfg = getConfig(api)
    const rawPluginConfig = (api as any).pluginConfig ?? null
    const rawConfigEntries = (api as any).config?.plugins?.entries ?? null
    ok(gwCtx, {
      ...state,
      runtime: {
        runtimeLeaseOwnerPid: state.runtimeLeaseOwnerPid,
        currentPid: process?.pid ?? null,
      },
      config: {
        knotworkBackendUrl: cfg.knotworkBackendUrl ?? null,
        autoHandshakeOnStart: cfg.autoHandshakeOnStart ?? true,
        taskPollIntervalMs: cfg.taskPollIntervalMs ?? 2000,
      },
      _debug: { rawPluginConfig, rawConfigEntries },
    })
  })

  rpc('knotwork.logs', async (gwCtx: GatewayMethodContext) => {
    ok(gwCtx, { logs: state.logs, count: state.logs.length, recentTasks: state.recentTasks })
  })

  const handleHandshake = async (gwCtx: GatewayMethodContext): Promise<void> => {
    const payload = getPayload(gwCtx)
    const overrides: Partial<PluginConfig> = {}
    if (typeof payload.knotworkBackendUrl === 'string') overrides.knotworkBackendUrl = payload.knotworkBackendUrl
    if (typeof payload.handshakeToken === 'string') overrides.handshakeToken = payload.handshakeToken
    if (typeof payload.pluginInstanceId === 'string') overrides.pluginInstanceId = payload.pluginInstanceId
    const cfg = getConfig(api)
    log(`handshake:debug url=${cfg.knotworkBackendUrl ?? 'MISSING'} token=${cfg.handshakeToken ? 'present' : 'MISSING'} overrides=${JSON.stringify(overrides)}`)
    try {
      const resp = await runHandshake(overrides)
      ok(gwCtx, { ok: true, pluginInstanceId: state.pluginInstanceId, result: resp })
    } catch (err) {
      const error = rememberError(err)
      state.lastHandshakeOk = false
      state.lastHandshakeAt = new Date().toISOString()
      log(`handshake:error ${error}`)
      ok(gwCtx, { ok: false, error })
    }
  }

  rpc('knotwork.handshake', handleHandshake)
  rpc('knotwork.sync_agents', handleHandshake) // alias — re-handshake re-syncs agents

  // Execute a task inside a gateway request context (required for subagent.run()).
  // Primary path: caller passes a pre-claimed task via --params { task: {...} }.
  // Fallback path: no task in params → full pull-then-run cycle (legacy/manual use).
  //
  // NOTE: ok() must be called AFTER awaiting the task — subagent.run() is bound to the
  // gateway request context (gwCtx). Calling ok() first terminates that context and
  // subagent.run() fails immediately with no task:start logged.
  // The subprocess therefore lives for the full duration of the agent session.
  // The TTL watchdog in plugin.ts handles the stuck-subprocess (half-open TCP) case.
  const handleExecuteTask = async (gwCtx: GatewayMethodContext): Promise<void> => {
    const payload = getPayload(gwCtx)
    const preClaimedTask = (payload.task ?? null) as ExecutionTask | null
    try {
      if (preClaimedTask) {
        await runClaimedTask(preClaimedTask)
      } else {
        await pollAndRun()
      }
      ok(gwCtx, { ok: true })
    } catch (err) {
      const error = rememberError(err)
      log(`execute_task:error ${error}`)
      ok(gwCtx, { ok: false, error })
    }
  }
  rpc('knotwork.execute_task', handleExecuteTask)
  rpc('knotwork.process_once', handleExecuteTask) // backward-compat alias

  rpc('knotwork.reset_connection', async (gwCtx: GatewayMethodContext) => {
    const payload = getPayload(gwCtx)
    const resetInstanceId = payload.resetInstanceId === true
    await resetPersistedSecret(resetInstanceId)
    state.lastError = null
    state.lastHandshakeOk = false
    state.recentTasks = []
    state.logs = []
    log(`connection:reset resetInstanceId=${resetInstanceId}`)
    ok(gwCtx, { ok: true, pluginInstanceId: state.pluginInstanceId, resetInstanceId, stateFilePath: state.stateFilePath })
  })
}

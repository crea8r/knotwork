// rpc.ts — Gateway RPC method registrations (knotwork.* methods).
// Callable from any terminal: `openclaw gateway call knotwork.<method>`

import { getConfig } from '../openclaw/bridge'
import type { GatewayMethodContext, HandshakeResponse, LooseRecord, OpenClawApi, PluginConfig, PluginState } from '../types'

export type RpcCtx = {
  state: PluginState
  api: OpenClawApi
  log: (msg: string) => void
  rememberError: (err: unknown) => string
  runHandshake: (overrides?: Partial<PluginConfig>) => Promise<HandshakeResponse>
  pollAndRun: () => Promise<void>
  resetPersistedSecret: (resetInstanceId?: boolean) => Promise<void>
}

function getPayload(ctx: GatewayMethodContext): LooseRecord {
  return (ctx.request?.payload ?? ctx.payload ?? {}) as LooseRecord
}

function ok(ctx: GatewayMethodContext, payload: LooseRecord): void {
  if (typeof ctx.respond === 'function') ctx.respond(true, payload)
}

export function registerRpcMethods(ctx: RpcCtx): void {
  const { api, state, log, rememberError, runHandshake, pollAndRun, resetPersistedSecret } = ctx
  if (typeof api.registerGatewayMethod !== 'function') return
  const rpc = api.registerGatewayMethod.bind(api)

  rpc('knotwork.status', async (gwCtx: GatewayMethodContext) => {
    const cfg = getConfig(api)
    ok(gwCtx, {
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

  rpc('knotwork.logs', async (gwCtx: GatewayMethodContext) => {
    ok(gwCtx, { logs: state.logs, count: state.logs.length, recentTasks: state.recentTasks })
  })

  const handleHandshake = async (gwCtx: GatewayMethodContext): Promise<void> => {
    const payload = getPayload(gwCtx)
    try {
      const resp = await runHandshake({
        knotworkBackendUrl: payload.knotworkBackendUrl as string | undefined,
        handshakeToken: payload.handshakeToken as string | undefined,
        pluginInstanceId: payload.pluginInstanceId as string | undefined,
      })
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

  rpc('knotwork.process_once', async (gwCtx: GatewayMethodContext) => {
    try {
      await pollAndRun()
      ok(gwCtx, { ok: true })
    } catch (err) {
      const error = rememberError(err)
      log(`process_once:error ${error}`)
      ok(gwCtx, { ok: false, error })
    }
  })

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

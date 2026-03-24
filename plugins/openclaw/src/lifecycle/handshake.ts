// handshake.ts — Knotwork handshake, credential recovery, retry scheduling.

import { discoverAgents, doHandshake, getConfig, resolveInstanceId } from '../openclaw/bridge'
import { isOperatorScopeError, verifyGatewayOperatorScopes } from '../openclaw/session'
import type { HandshakeResponse, OpenClawApi, PluginConfig, PluginState } from '../types'

const HANDSHAKE_RETRY_MS = 15_000

export type HandshakeCtx = {
  state: PluginState
  api: OpenClawApi
  log: (msg: string) => void
  rememberError: (err: unknown) => string
  persistState: () => Promise<void>
}

export type TimerRef = { current: ReturnType<typeof setTimeout> | null }

export function isInvalidCredentialsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /invalid plugin credentials/i.test(msg) || /\(401\)/.test(msg)
}

export async function runHandshake(
  ctx: HandshakeCtx, overrides: Partial<PluginConfig> = {},
): Promise<HandshakeResponse> {
  const { state, api, log, persistState } = ctx
  const cfg = { ...getConfig(api), ...overrides }
  if (!cfg.knotworkBackendUrl) {
    log(`handshakeToken: ${cfg.handshakeToken}`)
    throw new Error('Missing knotworkBackendUrl in plugin config')
  }
  if (!cfg.handshakeToken) {
    log(`knotworkBackendUrl: ${cfg.knotworkBackendUrl}`)
    throw new Error('Missing handshakeToken in plugin config')
  }
  const instanceId = state.pluginInstanceId ?? resolveInstanceId(cfg)
  try {
    await verifyGatewayOperatorScopes(api)
  } catch (err) {
    log(`handshake:scope-preflight-warning ${err instanceof Error ? err.message : String(err)}`)
  }
  const agents = await discoverAgents(api)
  log(`handshake:agents count=${agents.length} ids=${agents.map((a) => a.remote_agent_id).join(',') || 'none'}`)
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

export function scheduleHandshakeRetry(ctx: HandshakeCtx, timerRef: TimerRef, reason: string): void {
  if (timerRef.current) return
  timerRef.current = setTimeout(() => {
    timerRef.current = null
    runHandshake(ctx).catch((err: unknown) => {
      ctx.state.lastHandshakeOk = false
      ctx.state.lastHandshakeAt = new Date().toISOString()
      ctx.state.lastError = ctx.rememberError(err)
      ctx.log(`handshake:retry-failed reason=${reason} error=${ctx.state.lastError}`)
      if (isOperatorScopeError(err)) {
        ctx.log('handshake:retry-stopped reason=missing_required_operator_scope')
        return
      }
      scheduleHandshakeRetry(ctx, timerRef, 'retry_failed')
    })
  }, HANDSHAKE_RETRY_MS)
}

export async function recoverCredentials(
  ctx: HandshakeCtx, timerRef: TimerRef, reason: string,
): Promise<boolean> {
  const { state, api, log, rememberError } = ctx
  const cfg = getConfig(api)
  if (!cfg.knotworkBackendUrl || !cfg.handshakeToken) {
    log(`handshake:skipped reason=${reason} missing_config=true`)
    return false
  }
  try {
    await runHandshake(ctx)
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
    scheduleHandshakeRetry(ctx, timerRef, 'recover_failed')
    return false
  }
}

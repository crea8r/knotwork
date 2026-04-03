// auth.ts — ed25519 challenge-response authentication with Knotwork.
// Replaces handshake.ts (integration_secret). Agents authenticate as workspace members
// using their ed25519 private key, receiving a 30-day JWT bearer token.
//
// Key generation (one-time setup):
//   openssl genpkey -algorithm ed25519 -out ~/.openclaw/knotwork.key
//   openssl pkey -in ~/.openclaw/knotwork.key -pubout -out /dev/stdout | openssl pkey -pubin -outform DER | tail -c 32 | base64 | tr '+/' '-_' | tr -d '='
// The last command prints the base64url public key to paste into Knotwork Settings → Members.

import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { getConfig } from '../openclaw/bridge'
import type { OpenClawApi, PluginConfig, PluginState } from '../types'

const AUTH_RETRY_MS = 15_000
// Renew JWT when this many ms remain before expiry
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000 // 24 hours

export type AuthCtx = {
  state: PluginState
  api: OpenClawApi
  log: (msg: string) => void
  rememberError: (err: unknown) => string
  persistState: () => Promise<void>
}

export type TimerRef = { current: ReturnType<typeof setTimeout> | null }

export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\(401\)/.test(msg) || /unauthorized/i.test(msg) || /invalid.*token/i.test(msg)
}

export function isJwtExpiringSoon(state: PluginState): boolean {
  if (!state.jwtExpiresAt) return true
  const expiresMs = new Date(state.jwtExpiresAt).getTime()
  return Date.now() + RENEW_BEFORE_MS >= expiresMs
}

/** Extract the 32-byte raw ed25519 public key as base64url from a PEM private key file. */
export function getPublicKeyB64(privateKeyPath: string): string {
  const pem = readFileSync(privateKeyPath, 'utf8')
  const privateKey = createPrivateKey(pem)
  const publicKey = createPublicKey(privateKey)
  // SPKI DER format: the raw 32-byte public key is always the last 32 bytes
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const rawKey = spkiDer.subarray(-32)
  return rawKey.toString('base64url')
}

function signNonce(nonce: string, privateKeyPath: string): string {
  const pem = readFileSync(privateKeyPath, 'utf8')
  const privateKey = createPrivateKey(pem)
  const sig = sign(null, Buffer.from(nonce, 'utf8'), privateKey)
  return sig.toString('base64url')
}

function parseJwtExpiry(token: string): string | null {
  try {
    const [, payloadB64] = token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as { exp?: number }
    if (typeof payload.exp === 'number') {
      return new Date(payload.exp * 1000).toISOString()
    }
  } catch { /* ignore */ }
  return null
}

async function httpPost(url: string, body: Record<string, string>): Promise<{ ok: boolean; status: number; data: Record<string, string> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const data: Record<string, string> = text ? (() => { try { return JSON.parse(text) } catch { return {} } })() : {}
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`)
  return { ok: res.ok, status: res.status, data }
}

export async function runAuth(ctx: AuthCtx, overrides: Partial<PluginConfig> = {}): Promise<void> {
  const { state, api, log, persistState } = ctx
  const cfg = { ...getConfig(api), ...overrides }

  if (!cfg.knotworkBackendUrl) throw new Error('Missing knotworkBackendUrl in plugin config')
  if (!cfg.workspaceId) throw new Error('Missing workspaceId in plugin config')
  if (!cfg.privateKeyPath) throw new Error('Missing privateKeyPath in plugin config')

  const base = cfg.knotworkBackendUrl.replace(/\/$/, '')
  const publicKey = getPublicKeyB64(cfg.privateKeyPath)

  log(`auth:start publicKey=${publicKey.slice(0, 12)}...`)

  // Step 1: request nonce
  const { data: challengeData } = await httpPost(`${base}/api/v1/auth/agent-challenge`, { public_key: publicKey })
  const nonce = challengeData.nonce
  if (!nonce) throw new Error('Challenge response missing nonce')

  // Step 2: sign nonce with private key
  const signature = signNonce(nonce, cfg.privateKeyPath)

  // Step 3: exchange signed nonce for JWT
  const { data: tokenData } = await httpPost(`${base}/api/v1/auth/agent-token`, {
    public_key: publicKey,
    nonce,
    signature,
  })
  const jwt = tokenData.access_token
  if (!jwt) throw new Error('Token response missing access_token')

  state.jwt = jwt
  state.jwtExpiresAt = parseJwtExpiry(jwt)
  state.lastAuthAt = new Date().toISOString()
  state.lastAuthOk = true
  state.lastError = null

  await persistState()
  log(`auth:ok expiresAt=${state.jwtExpiresAt ?? 'unknown'}`)
}

export function scheduleAuthRetry(ctx: AuthCtx, timerRef: TimerRef, reason: string): void {
  if (timerRef.current) return
  timerRef.current = setTimeout(() => {
    timerRef.current = null
    runAuth(ctx).catch((err: unknown) => {
      ctx.state.lastAuthOk = false
      ctx.state.lastAuthAt = new Date().toISOString()
      ctx.state.lastError = ctx.rememberError(err)
      ctx.log(`auth:retry-failed reason=${reason} error=${ctx.state.lastError}`)
      scheduleAuthRetry(ctx, timerRef, 'retry_failed')
    })
  }, AUTH_RETRY_MS)
}

export async function recoverAuth(
  ctx: AuthCtx, timerRef: TimerRef, reason: string,
): Promise<boolean> {
  const { state, api, log, rememberError } = ctx
  const cfg = getConfig(api)
  if (!cfg.knotworkBackendUrl || !cfg.workspaceId || !cfg.privateKeyPath) {
    log(`auth:skipped reason=${reason} missing_config=true`)
    return false
  }
  try {
    await runAuth(ctx)
    log(`auth:recovered reason=${reason}`)
    return true
  } catch (err) {
    state.lastAuthOk = false
    state.lastAuthAt = new Date().toISOString()
    state.lastError = rememberError(err)
    log(`auth:recover-failed reason=${reason} error=${state.lastError}`)
    scheduleAuthRetry(ctx, timerRef, 'recover_failed')
    return false
  }
}

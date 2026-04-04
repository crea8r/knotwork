import { createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { KnotworkAuthError } from './errors.js'
import type {
  KnotworkAgentChallenge,
  KnotworkAuthSession,
  KnotworkSigner,
  KnotworkTokenResponse,
} from './types.js'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    throw new KnotworkAuthError(`HTTP ${response.status}: ${text.slice(0, 240)}`)
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new KnotworkAuthError(`Expected JSON response, received: ${text.slice(0, 240)}`, {
      cause: error,
    })
  }
}

export function parseJwtExpiry(token: string): string | null {
  try {
    const [, payloadB64] = token.split('.')
    if (!payloadB64) return null
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      exp?: number
    }
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null
  } catch {
    return null
  }
}

export function createPemFileSigner(privateKeyPath: string): KnotworkSigner {
  return {
    async getPublicKey(): Promise<string> {
      const pem = await readFile(privateKeyPath, 'utf8')
      const privateKey = createPrivateKey(pem)
      const publicKey = createPublicKey(privateKey)
      const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
      return spkiDer.subarray(-32).toString('base64url')
    },
    async sign(message: string): Promise<string> {
      const pem = await readFile(privateKeyPath, 'utf8')
      const privateKey = createPrivateKey(pem)
      return sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64url')
    },
  }
}

export async function requestAgentChallenge(
  backendUrl: string,
  publicKey: string,
): Promise<KnotworkAgentChallenge> {
  const response = await fetch(`${normalizeBaseUrl(backendUrl)}/api/v1/auth/agent-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_key: publicKey }),
  })
  return parseJsonResponse<KnotworkAgentChallenge>(response)
}

export async function exchangeAgentToken(
  backendUrl: string,
  publicKey: string,
  nonce: string,
  signature: string,
): Promise<KnotworkTokenResponse> {
  const response = await fetch(`${normalizeBaseUrl(backendUrl)}/api/v1/auth/agent-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      public_key: publicKey,
      nonce,
      signature,
    }),
  })
  return parseJsonResponse<KnotworkTokenResponse>(response)
}

export async function authenticateKnotworkAgent(
  backendUrl: string,
  signer: KnotworkSigner,
): Promise<KnotworkAuthSession> {
  const publicKey = await signer.getPublicKey()
  const challenge = await requestAgentChallenge(backendUrl, publicKey)
  const signature = await signer.sign(challenge.nonce)
  const token = await exchangeAgentToken(backendUrl, publicKey, challenge.nonce, signature)

  if (!token.access_token) {
    throw new KnotworkAuthError('Token response missing access_token')
  }

  return {
    accessToken: token.access_token,
    expiresAt: parseJwtExpiry(token.access_token),
    publicKey,
  }
}

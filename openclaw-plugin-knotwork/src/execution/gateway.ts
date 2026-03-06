import type { AnyObj, OpenClawApi } from '../types'
import { pick, readEnv } from '../utils'

export function resolveGatewayPort(api: OpenClawApi): number {
  const cfg = (api.config || {}) as AnyObj
  const gw = (cfg.gateway || {}) as AnyObj
  const raw = pick(gw, ['port']) ?? readEnv('OPENCLAW_GATEWAY_PORT') ?? '18789'
  const n = parseInt(String(raw), 10)
  return Number.isFinite(n) && n > 0 ? n : 18789
}

export function resolveGatewayToken(api: OpenClawApi): string | null {
  const cfg = (api.config || {}) as AnyObj
  const gw = (cfg.gateway || {}) as AnyObj
  const auth = (gw.auth || {}) as AnyObj
  const token = String(
    pick(auth, ['token']) ||
      readEnv('OPENCLAW_GATEWAY_TOKEN') ||
      readEnv('OPENCLAW_GATEWAY_PASSWORD') ||
      '',
  ).trim()
  return token || null
}

function parseCliJson(stdout: string): AnyObj | null {
  const text = String(stdout || '').trim()
  if (!text) return null

  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') return parsed as AnyObj
  } catch {
    // fallthrough: CLI may emit non-JSON lines before final JSON line
  }

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (!line.startsWith('{') && !line.startsWith('[')) continue
    try {
      const parsed = JSON.parse(line) as unknown
      if (parsed && typeof parsed === 'object') return parsed as AnyObj
    } catch {
      // continue
    }
  }
  return null
}

export async function runGatewayCli(
  api: OpenClawApi,
  method: string,
  params: AnyObj,
  timeoutMs: number,
): Promise<AnyObj> {
  const runner = api.runtime?.system?.runCommandWithTimeout
  if (typeof runner !== 'function') {
    throw new Error('runtime.system.runCommandWithTimeout unavailable')
  }

  const cliPath = readEnv('OPENCLAW_CLI_PATH') || 'openclaw'
  const gatewayToken = resolveGatewayToken(api)
  const gatewayPassword = String(readEnv('OPENCLAW_GATEWAY_PASSWORD') || '').trim() || null
  const argv = [cliPath, 'gateway', 'call', method, '--json', '--timeout', String(Math.max(1000, timeoutMs))]
  if (gatewayToken) argv.push('--token', gatewayToken)
  if (!gatewayToken && gatewayPassword) argv.push('--password', gatewayPassword)
  argv.push('--params', JSON.stringify(params))

  const result = await runner(argv, { timeoutMs })
  if (result.code !== 0) {
    throw new Error(
      `gateway cli failed method=${method} code=${String(result.code)} stderr=${String(result.stderr || '').slice(0, 240)}`,
    )
  }
  const parsed = parseCliJson(String(result.stdout || ''))
  if (!parsed) {
    throw new Error(
      `gateway cli returned non-JSON output for method=${method}: ${String(result.stdout || '').slice(0, 240)}`,
    )
  }
  return parsed
}

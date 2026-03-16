// bridge.ts — all communication with Knotwork + OpenClaw agent discovery.
// Three responsibilities: config resolution, agent discovery, Knotwork HTTP calls.

import type { AnyObj, OpenClawApi, PluginConfig, RemoteAgent } from './types'

const PLUGIN_ID = 'knotwork-bridge'
const PLUGIN_VERSION = '0.2.0'

// ── Env helper ───────────────────────────────────────────────────────────────

function env(name: string): string | undefined {
  try {
    return (process?.env?.[name] as string | undefined)?.trim() || undefined
  } catch {
    return undefined
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

export function getConfig(api: OpenClawApi): PluginConfig {
  const direct = (api.pluginConfig ?? {}) as AnyObj
  const entries = ((api.config as AnyObj)?.plugins as AnyObj)?.entries as AnyObj | undefined
  const entry = (
    (entries?.[PLUGIN_ID] as AnyObj)?.config ??
    (entries?.knotwork as AnyObj)?.config ??
    {}
  ) as AnyObj
  const merged = { ...entry, ...direct } as PluginConfig
  return {
    knotworkBackendUrl: merged.knotworkBackendUrl ?? env('KNOTWORK_BACKEND_URL'),
    handshakeToken: merged.handshakeToken ?? env('KNOTWORK_HANDSHAKE_TOKEN'),
    pluginInstanceId: merged.pluginInstanceId ?? env('KNOTWORK_PLUGIN_INSTANCE_ID'),
    autoHandshakeOnStart:
      typeof merged.autoHandshakeOnStart === 'boolean'
        ? merged.autoHandshakeOnStart
        : (env('KNOTWORK_AUTO_HANDSHAKE_ON_START') ?? 'true') !== 'false',
    taskPollIntervalMs:
      typeof merged.taskPollIntervalMs === 'number'
        ? merged.taskPollIntervalMs
        : parseInt(env('KNOTWORK_TASK_POLL_INTERVAL_MS') ?? '2000', 10),
  }
}

export function resolveInstanceId(cfg: PluginConfig): string {
  if (cfg.pluginInstanceId?.trim()) return cfg.pluginInstanceId.trim()
  return `knotwork-${Math.random().toString(36).slice(2, 12)}`
}

// Gateway WebSocket config — port + auth token for the native protocol.
export function getGatewayConfig(api: OpenClawApi): { port: number; token: string | null } {
  const gw = ((api.config as AnyObj)?.gateway ?? {}) as AnyObj
  const auth = (gw.auth ?? {}) as AnyObj
  const port = parseInt(String(gw.port ?? env('OPENCLAW_GATEWAY_PORT') ?? '18789'), 10) || 18789
  const token = String(auth.token ?? env('OPENCLAW_GATEWAY_TOKEN') ?? '').trim() || null
  return { port, token }
}

// ── Agent discovery ───────────────────────────────────────────────────────────

function normalizeAgent(raw: unknown): RemoteAgent | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as AnyObj
  const id = [a.id, a.agentId, a.slug, a.name].find((v) => typeof v === 'string' && v)
  if (!id) return null
  const sid = String(id)
  const toolsRaw = Array.isArray(a.tools ?? a.skills) ? (a.tools ?? a.skills) : []
  const tools = (toolsRaw as unknown[]).map((t) => {
    if (typeof t === 'string') return { name: t, description: '' }
    const to = t as AnyObj
    return {
      name: String(to.name ?? to.id ?? 'tool'),
      description: String(to.description ?? ''),
      input_schema: (to.input_schema ?? to.schema ?? { type: 'object' }) as AnyObj,
    }
  })
  const rawDesc = a.description ?? a.about ?? a.shortDescription ?? a.summary
  const description = typeof rawDesc === 'string' && rawDesc.trim() ? rawDesc.trim() : undefined
  return {
    remote_agent_id: sid,
    slug: String(a.slug ?? sid),
    display_name: String(a.displayName ?? a.name ?? sid),
    description,
    tools,
    constraints: {
      model: a.model ?? null,
      max_tool_calls: a.maxToolCalls ?? a.max_tool_calls ?? null,
      max_runtime_seconds: a.maxRuntimeSeconds ?? a.max_runtime_seconds ?? null,
    },
  }
}

function unpackAgentList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as AnyObj
    const list = obj.agents ?? obj.list ?? obj.items ?? obj.data ?? (obj.result as AnyObj)?.agents
    if (Array.isArray(list)) return list
  }
  return []
}

export async function discoverAgents(api: OpenClawApi): Promise<RemoteAgent[]> {
  // 1. agents.list() SDK method
  if (typeof api.agents?.list === 'function') {
    try {
      const res = await api.agents.list({})
      const out = unpackAgentList(res).map(normalizeAgent).filter(Boolean) as RemoteAgent[]
      if (out.length) return out
    } catch { /* fallthrough */ }
  }
  // 2. gateway call
  if (typeof api.gateway?.call === 'function') {
    for (const method of ['agents.list', 'agent.list']) {
      try {
        const res = await api.gateway.call(method, {})
        const out = unpackAgentList(res).map(normalizeAgent).filter(Boolean) as RemoteAgent[]
        if (out.length) return out
      } catch { /* try next */ }
    }
  }
  // 3. config.agents.list fallback
  const cfgList = unpackAgentList(((api.config as AnyObj)?.agents as AnyObj)?.list)
  const fromCfg = cfgList.map(normalizeAgent).filter(Boolean) as RemoteAgent[]
  if (fromCfg.length) return fromCfg
  // 4. defaults stub (single "Main Agent")
  const defaults = ((api.config as AnyObj)?.agents as AnyObj)?.defaults as AnyObj | undefined
  if (defaults) {
    return [{
      remote_agent_id: 'main', slug: 'main', display_name: 'Main Agent', tools: [],
      constraints: { model: (defaults.model as AnyObj)?.primary ?? null },
    }]
  }
  return []
}

// ── Knotwork HTTP calls ───────────────────────────────────────────────────────

async function post(url: string, body: AnyObj, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const data: AnyObj | null = text
    ? (() => { try { return JSON.parse(text) as AnyObj } catch { return null } })()
    : null
  return { ok: res.ok, status: res.status, data, text }
}

export async function doHandshake(
  baseUrl: string, token: string, instanceId: string, agents: RemoteAgent[],
): Promise<AnyObj> {
  const resp = await post(`${baseUrl}/openclaw-plugin/handshake`, {
    token,
    plugin_instance_id: instanceId,
    plugin_version: PLUGIN_VERSION,
    metadata: { plugin_id: PLUGIN_ID, started_at: new Date().toISOString() },
    agents,
  })
  if (!resp.ok) throw new Error(`Handshake failed (${resp.status}): ${resp.text.slice(0, 300)}`)
  return resp.data ?? {}
}

export async function pullTask(
  baseUrl: string, instanceId: string, secret: string,
): Promise<AnyObj | null> {
  const resp = await post(
    `${baseUrl}/openclaw-plugin/pull-task`,
    { plugin_instance_id: instanceId },
    { 'X-Knotwork-Integration-Secret': secret },
  )
  if (!resp.ok) throw new Error(`Pull task failed (${resp.status}): ${resp.text.slice(0, 240)}`)
  return (resp.data?.task as AnyObj | undefined) ?? null
}

export async function postEvent(
  baseUrl: string, instanceId: string, secret: string,
  taskId: string, eventType: string, payload: AnyObj,
): Promise<void> {
  const resp = await post(
    `${baseUrl}/openclaw-plugin/tasks/${taskId}/event`,
    { plugin_instance_id: instanceId, event_type: eventType, payload },
    { 'X-Knotwork-Integration-Secret': secret },
  )
  if (!resp.ok) throw new Error(`Post event failed (${resp.status}): ${resp.text.slice(0, 240)}`)
}

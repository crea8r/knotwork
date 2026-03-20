// bridge.ts — all communication with Knotwork + OpenClaw agent discovery.
// Three responsibilities: config resolution, agent discovery, Knotwork HTTP calls.

import type {
  ExecutionTask,
  HandshakeResponse,
  JsonObject,
  LooseRecord,
  OpenClawApi,
  PluginConfig,
  RemoteAgent,
  RemoteTool,
} from '../types'

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
  const direct = (api.pluginConfig ?? {}) as LooseRecord
  const entries = (((api.config ?? {}) as LooseRecord).plugins as LooseRecord | undefined)?.entries as LooseRecord | undefined
  const entry = (
    (entries?.[PLUGIN_ID] as LooseRecord | undefined)?.config ??
    (entries?.knotwork as LooseRecord | undefined)?.config ??
    {}
  ) as LooseRecord
  const merged = { ...entry, ...direct }
  return {
    knotworkBackendUrl: typeof merged.knotworkBackendUrl === 'string' ? merged.knotworkBackendUrl : env('KNOTWORK_BACKEND_URL'),
    handshakeToken: typeof merged.handshakeToken === 'string' ? merged.handshakeToken : env('KNOTWORK_HANDSHAKE_TOKEN'),
    pluginInstanceId: typeof merged.pluginInstanceId === 'string' ? merged.pluginInstanceId : env('KNOTWORK_PLUGIN_INSTANCE_ID'),
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

// Gateway WebSocket config — port + auth credentials for the native protocol.
// token + password + nonce are all required for the connect.challenge handshake.
export function getGatewayConfig(api: OpenClawApi): { port: number; token: string | null; password: string | null } {
  const gw = (((api.config ?? {}) as LooseRecord).gateway ?? {}) as LooseRecord
  const auth = (gw.auth ?? {}) as LooseRecord
  const port = parseInt(String(gw.port ?? env('OPENCLAW_GATEWAY_PORT') ?? '18789'), 10) || 18789
  const token = String(auth.token ?? env('OPENCLAW_GATEWAY_TOKEN') ?? '').trim() || null
  const password = String(auth.password ?? env('OPENCLAW_GATEWAY_PASSWORD') ?? '').trim() || null
  return { port, token, password }
}

// ── Agent discovery ───────────────────────────────────────────────────────────

function normalizeAgent(raw: unknown): RemoteAgent | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as LooseRecord
  const id = [a.id, a.agentId, a.slug, a.name].find((v) => typeof v === 'string' && v)
  if (!id) return null
  const sid = String(id)
  const toolsRaw = Array.isArray(a.tools ?? a.skills) ? (a.tools ?? a.skills) : []
  const tools = (toolsRaw as unknown[]).map(normalizeTool)
  const rawDesc = a.description ?? a.about ?? a.shortDescription ?? a.summary
  const description = typeof rawDesc === 'string' && rawDesc.trim() ? rawDesc.trim() : undefined
  return {
    remote_agent_id: sid,
    slug: String(a.slug ?? sid),
    display_name: String(a.displayName ?? a.display_name ?? a.name ?? sid),
    description,
    tools,
    constraints: {
      model: a.model ?? null,
      max_tool_calls: a.maxToolCalls ?? a.max_tool_calls ?? null,
      max_runtime_seconds: a.maxRuntimeSeconds ?? a.max_runtime_seconds ?? null,
    },
  }
}

function normalizeTool(raw: unknown): RemoteTool {
  if (typeof raw === 'string') return { name: raw, description: '' }
  if (!raw || typeof raw !== 'object') return { name: 'tool', description: '' }
  const tool = raw as LooseRecord
  return {
    name: String(tool.name ?? tool.id ?? 'tool'),
    description: String(tool.description ?? ''),
    input_schema: asJsonObject(tool.input_schema ?? tool.schema ?? { type: 'object' }),
  }
}

function unpackAgentList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as LooseRecord
    const result = obj.result
    const nested = result && typeof result === 'object' ? (result as LooseRecord).agents : undefined
    const list = obj.agents ?? obj.list ?? obj.items ?? obj.data ?? nested
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
  // 2. config.agents.list fallback
  const config = (api.config ?? {}) as LooseRecord
  const agentsConfig = (config.agents ?? {}) as LooseRecord
  const cfgList = unpackAgentList(agentsConfig.list)
  const fromCfg = cfgList.map(normalizeAgent).filter(Boolean) as RemoteAgent[]
  if (fromCfg.length) return fromCfg
  // 4. defaults stub (single "Main Agent")
  const defaults = agentsConfig.defaults as LooseRecord | undefined
  if (defaults) {
    return [{
      remote_agent_id: 'main', slug: 'main', display_name: 'Main Agent', tools: [],
      constraints: { model: (defaults.model as LooseRecord | undefined)?.primary ?? null },
    }]
  }
  return []
}

// ── Knotwork HTTP calls ───────────────────────────────────────────────────────

type HttpResponse<TData> = {
  ok: boolean
  status: number
  data: TData | null
  text: string
}

async function post<TData extends LooseRecord>(
  url: string,
  body: LooseRecord,
  headers: Record<string, string> = {},
): Promise<HttpResponse<TData>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const data: TData | null = text
    ? (() => { try { return JSON.parse(text) as TData } catch { return null } })()
    : null
  return { ok: res.ok, status: res.status, data, text }
}

export async function doHandshake(
  baseUrl: string, token: string, instanceId: string, agents: RemoteAgent[],
): Promise<HandshakeResponse> {
  const resp = await post<HandshakeResponse>(`${baseUrl}/openclaw-plugin/handshake`, {
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
): Promise<ExecutionTask | null> {
  const resp = await post<{ task?: ExecutionTask }>(
    `${baseUrl}/openclaw-plugin/pull-task`,
    { plugin_instance_id: instanceId },
    { 'X-Knotwork-Integration-Secret': secret },
  )
  if (!resp.ok) throw new Error(`Pull task failed (${resp.status}): ${resp.text.slice(0, 240)}`)
  return resp.data?.task ?? null
}

export async function postEvent(
  baseUrl: string, instanceId: string, secret: string,
  taskId: string, eventType: string, payload: LooseRecord,
): Promise<void> {
  const resp = await post<LooseRecord>(
    `${baseUrl}/openclaw-plugin/tasks/${taskId}/event`,
    { plugin_instance_id: instanceId, event_type: eventType, payload },
    { 'X-Knotwork-Integration-Secret': secret },
  )
  if (!resp.ok) throw new Error(`Post event failed (${resp.status}): ${resp.text.slice(0, 240)}`)
}

function asJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as JsonObject
}

// bridge.ts — all communication with Knotwork + OpenClaw agent discovery.
// Three responsibilities: config resolution, agent discovery, Knotwork HTTP calls.

import type {
  ChannelAssetBinding,
  ChannelInfo,
  ChannelMessage,
  ParticipantInfo,
  ChannelSubscription,
  EscalationInfo,
  InboxEvent,
  JsonObject,
  KnowledgeFileSummary,
  KnowledgeFileWithContent,
  LooseRecord,
  ObjectiveInfo,
  OpenClawApi,
  PluginConfig,
  ProjectDashboardInfo,
  RemoteAgent,
  RemoteTool,
  RunInfo,
  RunNodeStateInfo,
  WorkspaceMemberInfo,
} from '../types'
import { readFileSync } from 'node:fs'

const PLUGIN_ID = 'knotwork-bridge'
const PLUGIN_VERSION = (() => {
  try {
    const raw = readFileSync(new URL('../../openclaw.plugin.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

// suppress unused warning — version is included in request headers for debugging
void PLUGIN_VERSION

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
    workspaceId: typeof merged.workspaceId === 'string' ? merged.workspaceId : env('KNOTWORK_WORKSPACE_ID'),
    privateKeyPath: typeof merged.privateKeyPath === 'string' ? merged.privateKeyPath : env('KNOTWORK_PRIVATE_KEY_PATH'),
    pluginInstanceId: typeof merged.pluginInstanceId === 'string' ? merged.pluginInstanceId : env('KNOTWORK_PLUGIN_INSTANCE_ID'),
    autoAuthOnStart:
      typeof merged.autoAuthOnStart === 'boolean'
        ? merged.autoAuthOnStart
        : (env('KNOTWORK_AUTO_AUTH_ON_START') ?? 'true') !== 'false',
    taskPollIntervalMs:
      typeof merged.taskPollIntervalMs === 'number'
        ? merged.taskPollIntervalMs
        : parseInt(env('KNOTWORK_TASK_POLL_INTERVAL_MS') ?? '30000', 10),
    semanticActionProtocolEnabled:
      typeof merged.semanticActionProtocolEnabled === 'boolean'
        ? merged.semanticActionProtocolEnabled
        : (env('KNOTWORK_SEMANTIC_ACTION_PROTOCOL_ENABLED') ?? 'false') === 'true',
    semanticActionStrictMode:
      typeof merged.semanticActionStrictMode === 'boolean'
        ? merged.semanticActionStrictMode
        : (env('KNOTWORK_SEMANTIC_ACTION_STRICT_MODE') ?? 'false') === 'true',
    knotworkTransportMode:
      merged.knotworkTransportMode === 'mcp' || merged.knotworkTransportMode === 'rest'
        ? merged.knotworkTransportMode
        : (env('KNOTWORK_TRANSPORT_MODE') === 'mcp' ? 'mcp' : 'rest'),
  }
}

export function resolveInstanceId(cfg: PluginConfig): string {
  if (cfg.pluginInstanceId?.trim()) return cfg.pluginInstanceId.trim()
  return `knotwork-${Math.random().toString(36).slice(2, 12)}`
}

// Gateway WebSocket config — port + auth credentials for the native protocol.
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
    } catch (e) {
      console.log(`[knotwork-bridge] agents-list-error ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // 2. config.agents.list fallback
  const config = (api.config ?? {}) as LooseRecord
  const agentsConfig = (config.agents ?? {}) as LooseRecord
  const cfgList = unpackAgentList(agentsConfig.list)
  const fromCfg = cfgList.map(normalizeAgent).filter(Boolean) as RemoteAgent[]
  if (fromCfg.length) return fromCfg
  // 3. defaults stub
  const defaults = agentsConfig.defaults as LooseRecord | undefined
  if (defaults) {
    const name = String(defaults.displayName ?? defaults.display_name ?? defaults.name ?? 'Main Agent')
    return [{
      remote_agent_id: 'main', slug: 'main', display_name: name, tools: [],
      constraints: { model: (defaults.model as LooseRecord | undefined)?.primary ?? null },
    }]
  }
  return []
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function bearerHeaders(jwt: string): Record<string, string> {
  return { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' }
}

async function httpGet<T>(url: string, jwt: string): Promise<T> {
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${jwt}` } })
  const text = await res.text()
  if (!res.ok) throw new Error(`GET ${url} failed (${res.status}): ${text.slice(0, 240)}`)
  return JSON.parse(text) as T
}

async function httpPost<T>(url: string, body: LooseRecord, jwt: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: bearerHeaders(jwt),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`POST ${url} failed (${res.status}): ${text.slice(0, 240)}`)
  return (text ? JSON.parse(text) : {}) as T
}

async function httpPatch(url: string, body: LooseRecord, jwt: string): Promise<void> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: bearerHeaders(jwt),
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`PATCH ${url} failed (${res.status}): ${text.slice(0, 240)}`)
}

// ── Knotwork API calls ────────────────────────────────────────────────────────

/** Fetch unread inbox items for the authenticated agent participant. */
export async function pollInbox(baseUrl: string, workspaceId: string, jwt: string): Promise<InboxEvent[]> {
  const items = await httpGet<InboxEvent[]>(
    `${baseUrl}/api/v1/workspaces/${workspaceId}/inbox`,
    jwt,
  )
  return Array.isArray(items) ? items.filter((i) => i.unread) : []
}

/** Fetch the workspace guide document and its version number. */
export async function fetchGuide(baseUrl: string, workspaceId: string, jwt: string): Promise<{ guide_md: string | null; guide_version: number }> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/guide`, jwt)
}

export async function fetchChannel(baseUrl: string, workspaceId: string, jwt: string, channelRef: string): Promise<ChannelInfo> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/channels/${channelRef}`, jwt)
}

export async function fetchChannelMessages(baseUrl: string, workspaceId: string, jwt: string, channelRef: string): Promise<ChannelMessage[]> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/channels/${channelRef}/messages`, jwt)
}

export async function fetchChannelParticipants(baseUrl: string, workspaceId: string, jwt: string, channelRef: string): Promise<ParticipantInfo[]> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/channels/${channelRef}/participants`, jwt)
}

export async function fetchChannelAssets(baseUrl: string, workspaceId: string, jwt: string, channelRef: string): Promise<ChannelAssetBinding[]> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/channels/${channelRef}/assets`, jwt)
}

export async function fetchCurrentMember(baseUrl: string, workspaceId: string, jwt: string): Promise<WorkspaceMemberInfo> {
  const user = await httpGet<{ id: string }>(`${baseUrl}/api/v1/auth/me`, jwt)
  const page = await httpGet<{ items?: WorkspaceMemberInfo[] }>(
    `${baseUrl}/api/v1/workspaces/${workspaceId}/members?page_size=100`,
    jwt,
  )
  const member = (page.items ?? []).find((item) => item.user_id === user.id)
  if (!member) throw new Error('Current user is not a member of this workspace')
  return {
    ...member,
    participant_id: `${member.kind}:${member.id}`,
  }
}

export async function fetchObjective(baseUrl: string, workspaceId: string, jwt: string, objectiveRef: string): Promise<ObjectiveInfo> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/objectives/${objectiveRef}`, jwt)
}

export async function fetchObjectiveChain(baseUrl: string, workspaceId: string, jwt: string, objectiveRef: string): Promise<ObjectiveInfo[]> {
  const chain: ObjectiveInfo[] = []
  const seen = new Set<string>()
  let currentRef: string | null = objectiveRef

  while (currentRef) {
    if (seen.has(currentRef)) throw new Error(`Objective ancestry cycle detected at ${currentRef}`)
    seen.add(currentRef)
    const objective = await fetchObjective(baseUrl, workspaceId, jwt, currentRef)
    chain.push(objective)
    currentRef = objective.parent_objective_id ?? null
  }

  return chain.reverse()
}

export async function fetchProjectDashboard(baseUrl: string, workspaceId: string, jwt: string, projectRef: string): Promise<ProjectDashboardInfo> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/projects/${projectRef}/dashboard`, jwt)
}

export async function fetchMyChannelSubscriptions(baseUrl: string, workspaceId: string, jwt: string): Promise<ChannelSubscription[]> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/channels/subscriptions/me`, jwt)
}

export async function postChannelMessage(
  baseUrl: string,
  workspaceId: string,
  jwt: string,
  channelRef: string,
  content: string,
  authorName: string,
  runId?: string,
): Promise<ChannelMessage> {
  return httpPost(
    `${baseUrl}/api/v1/workspaces/${workspaceId}/channels/${channelRef}/messages`,
    {
      role: 'assistant',
      author_type: 'agent',
      author_name: authorName,
      content,
      run_id: runId ?? null,
    },
    jwt,
  )
}

export async function fetchRun(baseUrl: string, workspaceId: string, jwt: string, runId: string): Promise<RunInfo> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/runs/${runId}`, jwt)
}

export async function fetchRunNodes(baseUrl: string, workspaceId: string, jwt: string, runId: string): Promise<RunNodeStateInfo[]> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/runs/${runId}/nodes`, jwt)
}

export async function fetchEscalation(baseUrl: string, workspaceId: string, jwt: string, escalationId: string): Promise<EscalationInfo> {
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/escalations/${escalationId}`, jwt)
}

export async function resolveEscalation(
  baseUrl: string,
  workspaceId: string,
  jwt: string,
  escalationId: string,
  body: {
    resolution: string
    actor_name: string
    guidance?: string
    override_output?: Record<string, unknown> | null
    next_branch?: string | null
    answers?: string[] | null
    channel_id?: string | null
  },
): Promise<LooseRecord> {
  return httpPost(
    `${baseUrl}/api/v1/workspaces/${workspaceId}/escalations/${escalationId}/resolve`,
    {
      resolution: body.resolution,
      actor_name: body.actor_name,
      guidance: body.guidance ?? null,
      override_output: body.override_output ?? null,
      next_branch: body.next_branch ?? null,
      answers: body.answers ?? null,
      channel_id: body.channel_id ?? null,
    },
    jwt,
  )
}

export async function listKnowledgeFiles(baseUrl: string, workspaceId: string, jwt: string, projectId?: string | null): Promise<KnowledgeFileSummary[]> {
  const params = new URLSearchParams()
  if (projectId) params.set('project_id', projectId)
  const query = params.toString()
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/knowledge${query ? `?${query}` : ''}`, jwt)
}

export async function fetchKnowledgeFile(baseUrl: string, workspaceId: string, jwt: string, path: string, projectId?: string | null): Promise<KnowledgeFileWithContent> {
  const params = new URLSearchParams({ path })
  if (projectId) params.set('project_id', projectId)
  return httpGet(`${baseUrl}/api/v1/workspaces/${workspaceId}/knowledge/file?${params.toString()}`, jwt)
}

export async function createKnowledgeChange(
  baseUrl: string,
  workspaceId: string,
  jwt: string,
  body: {
    path: string
    proposed_content: string
    reason: string
    run_id?: string | null
    node_id?: string | null
    agent_ref?: string | null
    source_channel_id?: string | null
    action_type?: string
    target_type?: string
    payload?: Record<string, unknown>
  },
): Promise<LooseRecord> {
  return httpPost(
    `${baseUrl}/api/v1/workspaces/${workspaceId}/knowledge/changes`,
    {
      path: body.path,
      proposed_content: body.proposed_content,
      reason: body.reason,
      run_id: body.run_id ?? null,
      node_id: body.node_id ?? null,
      agent_ref: body.agent_ref ?? null,
      source_channel_id: body.source_channel_id ?? null,
      action_type: body.action_type ?? 'update_content',
      target_type: body.target_type ?? 'file',
      payload: body.payload ?? {},
    },
    jwt,
  )
}

/** Mark a single inbox delivery as read via its delivery_id. */
export async function ackInboxDelivery(baseUrl: string, workspaceId: string, jwt: string, deliveryId: string): Promise<void> {
  await httpPatch(
    `${baseUrl}/api/v1/workspaces/${workspaceId}/inbox/deliveries/${deliveryId}`,
    { read: true },
    jwt,
  )
}

/** Archive a handled inbox delivery so it no longer appears in the active inbox. */
export async function archiveInboxDelivery(baseUrl: string, workspaceId: string, jwt: string, deliveryId: string): Promise<void> {
  await httpPatch(
    `${baseUrl}/api/v1/workspaces/${workspaceId}/inbox/deliveries/${deliveryId}`,
    { read: true, archived: true },
    jwt,
  )
}


function asJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as JsonObject
}

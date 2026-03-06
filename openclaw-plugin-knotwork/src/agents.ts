import type { AnyObj, OpenClawApi } from './types'
import { pick } from './utils'

function toToolInfo(tool: unknown): AnyObj {
  if (typeof tool === 'string') {
    return { name: tool, description: '' }
  }
  if (tool && typeof tool === 'object') {
    const t = tool as AnyObj
    return {
      name: String(pick(t, ['name', 'id', 'slug', 'title']) || 'unknown_tool'),
      description: String(pick(t, ['description', 'summary']) || ''),
      input_schema: (pick(t, ['input_schema', 'schema', 'params']) as AnyObj | undefined) || {
        type: 'object',
      },
    }
  }
  return { name: 'unknown_tool', description: '' }
}

function normalizeAgent(raw: unknown): AnyObj | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as AnyObj
  const id = String(pick(a, ['id', 'agentId', 'slug', 'name']) || '')
  if (!id) return null

  const slug = String(pick(a, ['slug', 'id', 'name']) || id)
  const display = String(pick(a, ['displayName', 'name', 'slug', 'id']) || slug)
  const toolsRaw = (pick(a, ['tools', 'skills']) as unknown[]) || []
  const tools = Array.isArray(toolsRaw) ? toolsRaw.map(toToolInfo) : []

  const constraints: AnyObj = {
    model: pick(a, ['model']),
    max_tool_calls: pick(a, ['maxToolCalls', 'max_tool_calls']),
    max_runtime_seconds: pick(a, ['maxRuntimeSeconds', 'max_runtime_seconds']),
    network: pick(a, ['network']),
  }

  return {
    remote_agent_id: id,
    slug,
    display_name: display,
    tools,
    constraints,
  }
}

function unpackAgentList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as AnyObj
  const nested =
    (pick(obj, ['agents', 'list', 'items', 'data']) as unknown[]) ||
    (((obj.result as AnyObj | undefined)?.agents as unknown[]) || [])
  return Array.isArray(nested) ? nested : []
}

async function extractAgentsFromGateway(api: OpenClawApi): Promise<AnyObj[]> {
  if (api.agents && typeof api.agents.list === 'function') {
    try {
      const res = await api.agents.list({})
      const out: AnyObj[] = []
      for (const raw of unpackAgentList(res)) {
        const normalized = normalizeAgent(raw)
        if (normalized) out.push(normalized)
      }
      if (out.length > 0) return out
    } catch {
      // Fallback to gateway method calls.
    }
  }

  if (!api.gateway || typeof api.gateway.call !== 'function') return []
  const methods = ['agents.list', 'agent.list']

  for (const method of methods) {
    try {
      const res = await api.gateway.call(method, {})
      const out: AnyObj[] = []
      for (const raw of unpackAgentList(res)) {
        const normalized = normalizeAgent(raw)
        if (normalized) out.push(normalized)
      }
      if (out.length > 0) return out
    } catch {
      // Try next method.
    }
  }

  return []
}

function extractAgentsFromConfig(api: OpenClawApi): AnyObj[] {
  const cfg = api.config as AnyObj | undefined
  const agents = (((cfg?.agents as AnyObj | undefined)?.list as unknown[]) || [])
  const out: AnyObj[] = []
  for (const raw of agents) {
    const normalized = normalizeAgent(raw)
    if (normalized) out.push(normalized)
  }
  if (out.length > 0) return out

  const defaults = (cfg?.agents as AnyObj | undefined)?.defaults as AnyObj | undefined
  const model = ((defaults?.model as AnyObj | undefined)?.primary as string | undefined) || null
  if (defaults) {
    out.push({
      remote_agent_id: 'main',
      slug: 'main',
      display_name: 'Main Agent',
      tools: [],
      constraints: {
        model,
      },
    })
  }
  return out
}

export async function extractAgents(api: OpenClawApi): Promise<AnyObj[]> {
  const viaGateway = await extractAgentsFromGateway(api)
  if (viaGateway.length > 0) return viaGateway
  return extractAgentsFromConfig(api)
}

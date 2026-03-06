import type { AnyObj } from '../types'

function normalizeAgentName(agentRef: unknown): string {
  const raw = String(agentRef || 'openclaw:agent')
  return raw.replace(/^openclaw:/, '')
}

export function resolveSessionName(task: AnyObj): string {
  const provided = task.session_name
  if (typeof provided === 'string' && provided.trim()) return provided

  const workspaceId = String(task.workspace_id || 'unknown-workspace')
  const agentKey = String(
    task.agent_key || task.agent_id || task.remote_agent_id || normalizeAgentName(task.agent_ref) || 'agent',
  )
  const nodeId = String(task.node_id || '')
  if (nodeId.startsWith('agent_main')) return `knotwork:${agentKey}:${workspaceId}:main`
  if (nodeId === 'handbook') return `knotwork:${agentKey}:${workspaceId}:handbook`

  const runId = task.run_id ? String(task.run_id) : 'unknown'
  if (runId !== 'unknown') return `knotwork:${agentKey}:${workspaceId}:run:${runId}`
  return `knotwork:${agentKey}:${workspaceId}:node:${nodeId || 'unknown-node'}`
}

export function createIdempotencyKey(task: AnyObj): string {
  const taskId = String(task.task_id || 'task')
  const runId = String(task.run_id || 'run')
  const nodeId = String(task.node_id || 'node')
  const ts = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 10)
  return `knotwork:${runId}:${nodeId}:${taskId}:${ts}:${rnd}`
}

export function withAgentScopedSessionKey(sessionName: string, agentId: string): string {
  const cleanedAgent = String(agentId || '').trim()
  if (!cleanedAgent) return sessionName
  if (sessionName.startsWith('agent:')) return sessionName
  return `agent:${cleanedAgent}:${sessionName}`
}

export type SessionIntent = {
  agentId: string
  idempotencyKey: string
  message: string
  extraSystemPrompt: string
  sessionName: string
  scopedSessionKey: string
}

export function buildSessionIntent(task: AnyObj): SessionIntent | null {
  const agentId = String(task.remote_agent_id || task.agent_id || '').trim()
  if (!agentId) return null
  const sessionName = resolveSessionName(task)
  return {
    agentId,
    idempotencyKey: createIdempotencyKey(task),
    message: String(task.user_prompt || ''),
    extraSystemPrompt: String(task.system_prompt || ''),
    sessionName,
    scopedSessionKey: withAgentScopedSessionKey(sessionName, agentId),
  }
}

// session.ts — Session execution: send message, wait for completion, parse output.
// Wire protocol: WebSocket JSON frames — see gateway.ts for the low-level RPC.
// create_session: implicit — OpenClaw auto-creates on first agent call.
// send_message:   rpc('agent', {agentId, sessionKey, idempotencyKey, message, extraSystemPrompt})
// sync_session:   rpc('agent.wait', {runId}) -> rpc('chat.history', {sessionKey})
// completion:     agent ends final message with ```json-decision block (confident|escalate)

import { getGatewayConfig } from './bridge'
import { gatewayRpc } from './gateway'
import { isOperatorScopeError, missingScope, scopeHelp } from './scope'
import type { ExecutionTask, LooseRecord, OpenClawApi, TaskResult } from '../types'

const AGENT_WAIT_TIMEOUT_MS = 900_000
const AGENT_WAIT_RPC_TIMEOUT_MS = AGENT_WAIT_TIMEOUT_MS + 10_000

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Session key: scoped as agent:<id>:<knotworkKey> so it stays in the agent's namespace.
function buildSessionKey(task: ExecutionTask): string {
  const knotworkKey =
    typeof task.session_name === 'string' && task.session_name.trim()
      ? task.session_name.trim()
      : fallbackKey(task)
  const agentId = String(task.remote_agent_id ?? task.agent_id ?? 'main')
  return knotworkKey.startsWith('agent:') ? knotworkKey : `agent:${agentId}:${knotworkKey}`
}

function fallbackKey(task: ExecutionTask): string {
  const slug = String(task.agent_key ?? task.remote_agent_id ?? 'agent')
  const wsId = String(task.workspace_id ?? 'ws')
  const runId = task.run_id ? String(task.run_id) : null
  return runId ? `knotwork:${slug}:${wsId}:run:${runId}` : `knotwork:${slug}:${wsId}:main`
}

// Deterministic: same taskId -> same key. All operations become retry-safe.
function idempotencyKey(taskId: string): string {
  return `knotwork:task:${taskId}`
}

function latestAssistantMessage(history: LooseRecord): string {
  const messages = Array.isArray(history.messages) ? history.messages : []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as LooseRecord
    if (String(m.role ?? '').toLowerCase() !== 'assistant') continue
    const c = m.content
    if (typeof c === 'string' && c.trim()) return c.trim()
    if (Array.isArray(c)) {
      const t = (c as LooseRecord[]).map((p) => String(p.text ?? '')).filter(Boolean).join('\n').trim()
      if (t) return t
    }
  }
  return ''
}

// Parse the agent's structured ```json-decision block from the end of its final message.
// Returns a TaskResult if the block is present and valid; null if absent
// (treated as a confident completion by the caller).
function parseDecisionBlock(text: string): TaskResult | null {
  const FENCE = '```json-decision'
  const lastFence = text.lastIndexOf(FENCE)
  if (lastFence === -1) return null
  const newline = text.indexOf('\n', lastFence)
  if (newline === -1) return null
  const closeFence = text.indexOf('```', newline + 1)
  if (closeFence === -1) return null
  const jsonStr = text.slice(newline + 1, closeFence).trim()
  let d: LooseRecord
  try { d = JSON.parse(jsonStr) as LooseRecord } catch { return null }
  if (d.decision === 'escalate') {
    const message = text.slice(0, lastFence).trim()
    return {
      type: 'escalation',
      question: typeof d.question === 'string' && d.question.trim() ? d.question.trim() : 'Need human input',
      options: Array.isArray(d.options) ? (d.options as string[]) : [],
      message: message || undefined,
    }
  }
  const rawOutput = typeof d.output === 'string' ? d.output.trim() : ''
  const output = rawOutput || text.slice(0, lastFence).trim()
  const next_branch = typeof d.next_branch === 'string' ? d.next_branch : null
  return { type: 'completed', output, next_branch }
}

function parseResult(raw: unknown): TaskResult {
  if (!raw || typeof raw !== 'object') return { type: 'completed', output: String(raw ?? ''), next_branch: null }
  const r = raw as LooseRecord
  if (r.type === 'escalation' || r.needs_human === true) {
    return { type: 'escalation', question: String(r.question ?? r.message ?? 'Need human input'), options: Array.isArray(r.options) ? (r.options as string[]) : [] }
  }
  if (r.type === 'failed' || (r.error && !r.output && !r.output_text)) {
    return { type: 'failed', error: String(r.error ?? r.message ?? 'execution failed') }
  }
  const next_branch = typeof r.next_branch === 'string' ? r.next_branch : typeof r.nextBranch === 'string' ? r.nextBranch : null
  const text = r.output_text ?? r.output ?? r.text ?? r.message
  return { type: 'completed', output: typeof text === 'string' ? text.trim() : JSON.stringify(r), next_branch }
}

export async function executeTask(api: OpenClawApi, task: ExecutionTask): Promise<TaskResult> {
  const taskId = String(task.task_id ?? '')
  if (!taskId) throw new Error('task missing task_id')

  const gatewayCall = api.gateway?.call
  const { port, token } = getGatewayConfig(api)
  const sKey = buildSessionKey(task)
  const iKey = idempotencyKey(taskId)
  const agentId = String(task.remote_agent_id ?? task.agent_id ?? 'main')

  async function rpc(method: string, params: LooseRecord, timeoutMs = 90_000): Promise<unknown> {
    if (typeof gatewayCall === 'function') {
      try { return await gatewayCall(method, params) } catch (error) {
        if (!missingScope(error)) throw error
      }
    }
    try {
      return await gatewayRpc(port, token, method, params, timeoutMs)
    } catch (error) {
      const scope = missingScope(error)
      if (scope) throw scopeHelp(scope)
      throw error
    }
  }

  let started: LooseRecord
  try {
    started = (await rpc('agent', {
      agentId, sessionKey: sKey, idempotencyKey: iKey,
      message: String(task.user_prompt ?? ''),
      extraSystemPrompt: String(task.system_prompt ?? ''),
    })) as LooseRecord
  } catch (e) {
    throw new Error(`gateway 'agent' failed: ${toErrorMessage(e)}`)
  }

  const runId = [started.runId, started.run_id, started.id].find((v) => typeof v === 'string' && v)
  if (!runId) return parseResult(started)

  const waited = (await rpc('agent.wait', { runId, timeoutMs: AGENT_WAIT_TIMEOUT_MS }, AGENT_WAIT_RPC_TIMEOUT_MS)) as LooseRecord
  const status = String(waited.status ?? '')
  if (status === 'ok') {
    const history = (await rpc('chat.history', { sessionKey: sKey, limit: 50 }, 10_000)) as LooseRecord
    const lastMsg = latestAssistantMessage(history)
    return parseDecisionBlock(lastMsg) ?? { type: 'completed', output: lastMsg, next_branch: null }
  }
  if (status === 'error') return { type: 'failed', error: String(waited.error ?? waited.summary ?? 'agent error') }
  if (status === 'timeout') {
    // Fallback: query transcript before failing — wait can timeout while response is already present.
    try {
      const history = (await rpc('chat.history', { sessionKey: sKey, limit: 50 }, 10_000)) as LooseRecord
      const lastMsg = latestAssistantMessage(history)
      if (lastMsg) return parseDecisionBlock(lastMsg) ?? { type: 'completed', output: lastMsg, next_branch: null }
    } catch { /* ignore fallback errors */ }
    return { type: 'failed', error: `agent timed out after ${Math.floor(AGENT_WAIT_TIMEOUT_MS / 1000)}s` }
  }
  return parseResult(waited)
}

export async function verifyGatewayOperatorScopes(api: OpenClawApi): Promise<void> {
  const gatewayCall = api.gateway?.call
  const { port, token } = getGatewayConfig(api)

  async function rpc(method: string, params: LooseRecord, timeoutMs = 10_000): Promise<void> {
    let helperScopeError: string | null = null
    if (typeof gatewayCall === 'function') {
      try { await gatewayCall(method, params); return } catch (error) {
        const scope = missingScope(error)
        if (!scope) return
        helperScopeError = scope
      }
    }
    try {
      await gatewayRpc(port, token, method, params, timeoutMs)
    } catch (error) {
      const scope = missingScope(error)
      if (scope) throw scopeHelp(scope)
      if (helperScopeError) throw scopeHelp(helperScopeError)
      // Non-scope error means method reached gateway logic -> scope is granted.
    }
  }

  await rpc('chat.history', {})
  await rpc('agent', {})
}

// Re-export so callers that import isOperatorScopeError from './session' still work.
export { isOperatorScopeError } from './scope'

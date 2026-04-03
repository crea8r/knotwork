// session.ts — Session execution: send message, wait for completion, parse output.
// Uses api.runtime.subagent (injected by OpenClaw when plugin exports default register).
// create_session: implicit — OpenClaw auto-creates on first subagent.run call.
// send_message:   subagent.run({ sessionKey, message, extraSystemPrompt, idempotencyKey })
// sync_session:   subagent.waitForRun({ runId }) -> subagent.getSessionMessages({ sessionKey })
// completion:     agent ends final message with ```json-decision block (confident|escalate)

import type { ExecutionTask, LooseRecord, OpenClawApi, TaskResult } from '../types'

const AGENT_WAIT_TIMEOUT_MS = 900_000

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

function getSubagent(api: OpenClawApi) {
  const subagent = (api as any).runtime?.subagent
  if (typeof subagent?.run !== 'function') throw new Error('api.runtime.subagent not available — ensure plugin exports default register')
  return subagent as {
    run: (p: { sessionKey: string; message: string; extraSystemPrompt?: string; idempotencyKey?: string; deliver?: boolean }) => Promise<{ runId: string }>
    waitForRun: (p: { runId: string; timeoutMs?: number }) => Promise<{ status: string; error?: string }>
    getSessionMessages: (p: { sessionKey: string; limit?: number }) => Promise<{ messages: unknown[] }>
  }
}

function latestAssistantMessage(messages: unknown[]): string {
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
    // Support questions array or legacy single question
    let questions: string[] = []
    if (Array.isArray(d.questions) && d.questions.length > 0) {
      questions = (d.questions as unknown[]).map((q) => String(q).trim()).filter(Boolean)
    } else if (typeof d.question === 'string' && d.question.trim()) {
      questions = [d.question.trim()]
    }
    if (questions.length === 0) questions = ['Need human input']
    return {
      type: 'escalation',
      questions,
      options: Array.isArray(d.options) ? (d.options as string[]) : [],
      message: message || undefined,
    }
  }
  const rawOutput = typeof d.output === 'string' ? d.output.trim() : ''
  const output = rawOutput || text.slice(0, lastFence).trim()
  const next_branch = typeof d.next_branch === 'string' ? d.next_branch : null
  return { type: 'completed', output, next_branch }
}


export async function executeTask(api: OpenClawApi, task: ExecutionTask): Promise<TaskResult> {
  const taskId = String(task.task_id ?? '')
  if (!taskId) throw new Error('task missing task_id')

  const subagent = getSubagent(api)
  const sKey = buildSessionKey(task)
  const iKey = idempotencyKey(taskId)
  const subagentKeys = Object.keys(subagent as object).join(',')

  let started: { runId: string }
  try {
    started = await subagent.run({
      sessionKey: sKey,
      idempotencyKey: iKey,
      message: String(task.user_prompt ?? ''),
      extraSystemPrompt: String(task.system_prompt ?? '') || undefined,
      deliver: false,
    })
  } catch (e) {
    throw new Error(`subagent.run failed: ${toErrorMessage(e)} [subagent-keys: ${subagentKeys}] [sessionKey: ${sKey}] [idempotencyKey: ${iKey}] [pid: ${process?.pid ?? 'unknown'}]`)
  }

  const { runId } = started
  if (!runId) return { type: 'failed', error: 'subagent.run returned no runId' }

  const waited = await subagent.waitForRun({ runId, timeoutMs: AGENT_WAIT_TIMEOUT_MS })
  const status = String(waited.status ?? '')

  async function fetchLastMsg(): Promise<string> {
    const { messages } = await subagent.getSessionMessages({ sessionKey: sKey, limit: 50 })
    return latestAssistantMessage(messages)
  }

  if (status === 'ok') {
    const lastMsg = await fetchLastMsg()
    return parseDecisionBlock(lastMsg) ?? { type: 'completed', output: lastMsg, next_branch: null }
  }
  if (status === 'error') return { type: 'failed', error: `agent error: ${String(waited.error ?? 'unknown')} [runId: ${runId}] [sessionKey: ${sKey}]` }
  if (status === 'timeout') {
    try {
      const lastMsg = await fetchLastMsg()
      if (lastMsg) return parseDecisionBlock(lastMsg) ?? { type: 'completed', output: lastMsg, next_branch: null }
    } catch { /* ignore fallback errors */ }
    return { type: 'failed', error: `agent timed out after ${Math.floor(AGENT_WAIT_TIMEOUT_MS / 1000)}s [runId: ${runId}] [sessionKey: ${sKey}]` }
  }
  return { type: 'failed', error: `unexpected wait status: ${status} [runId: ${runId}] [sessionKey: ${sKey}]` }
}

export async function verifyGatewayOperatorScopes(api: OpenClawApi): Promise<void> {
  // With api.runtime.subagent there are no gateway scopes to verify.
  // Just confirm subagent is available; if not, surface a clear error.
  getSubagent(api)
}

// Re-export so callers that import isOperatorScopeError from './session' still work.
export { isOperatorScopeError } from './scope'

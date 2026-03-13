// session.ts — Session Execution Contract via native OpenClaw gateway protocol.
// Wire protocol: WebSocket JSON frames — {type:"req",id,method,params} / {type:"res",id,ok,payload|error}
// create_session: implicit — OpenClaw auto-creates on first agent call.
// send_message:   gatewayRpc('agent', {agentId, sessionKey, idempotencyKey, message, extraSystemPrompt})
// sync_session:   gatewayRpc('agent.wait', {runId}) → gatewayRpc('chat.history', {sessionKey})
// completion:     agent ends final message with ```json-decision block (confident|escalate)

import { getGatewayConfig } from './bridge'
import type { AnyObj, OpenClawApi, TaskResult } from './types'

const AGENT_WAIT_TIMEOUT_MS = 900_000
const AGENT_WAIT_RPC_TIMEOUT_MS = AGENT_WAIT_TIMEOUT_MS + 10_000
const OPERATOR_SCOPES = ['operator.read', 'operator.write']

type WsFrame = {
  type: string; id?: string; event?: string
  ok?: boolean; payload?: unknown; error?: unknown
}

// Low-level: one WebSocket connection = one RPC call.
// Handshake: send connect (auth embedded) → wait for hello-ok response → send RPC call.
// client.id must be a GATEWAY_CLIENT_IDS literal; mode must be a GATEWAY_CLIENT_MODES literal.
// maxProtocol must be >= PROTOCOL_VERSION (3). Auth token is inside connectParams.auth, not a
// separate 'auth' RPC step.
async function gatewayRpc(
  port: number, token: string | null, method: string, params: AnyObj, timeoutMs = 90_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const WS = (globalThis as AnyObj).WebSocket as typeof WebSocket
    if (typeof WS !== 'function') { reject(new Error('WebSocket not available in runtime')); return }

    const ws = new WS(`ws://127.0.0.1:${port}/`)
    const reqId = Math.random().toString(36).slice(2, 10)
    let settled = false

    const timer = setTimeout(
      () => done(() => reject(new Error(`gateway '${method}' timed out after ${timeoutMs}ms`))),
      timeoutMs,
    )

    function done(fn: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* ignore */ }
      fn()
    }

    function sendRequest() {
      ws.send(JSON.stringify({ type: 'req', id: reqId, method, params }))
    }

    const errStr = (e: unknown) =>
      e && typeof e === 'object' ? JSON.stringify(e) : String(e ?? 'unknown')

    ws.onopen = () => {
      // Build connect params: client fields are enum-constrained, auth token goes here (not in a
      // separate 'auth' RPC). Server sends a 'connect.challenge' event before this arrives — we
      // ignore it (no device auth required when using a shared token).
      const connectParams: AnyObj = {
        minProtocol: 1,
        maxProtocol: 3, // must be >= PROTOCOL_VERSION (3)
        client: {
          id: 'gateway-client',       // one of GATEWAY_CLIENT_IDS
          displayName: 'knotwork-bridge',
          version: '0.2.0',
          platform: typeof process !== 'undefined' ? process.platform : 'linux',
          mode: 'backend',
        },
        role: 'operator',
        scopes: OPERATOR_SCOPES,
        permissions: {},
      }
      if (token) connectParams.auth = { token }
      ws.send(JSON.stringify({ type: 'req', id: 'kw-connect', method: 'connect', params: connectParams }))
    }

    ws.onmessage = (ev: MessageEvent) => {
      let frame: WsFrame
      try { frame = JSON.parse(String(ev.data)) as WsFrame } catch { return }

      // Ignore server-pushed events (connect.challenge, tick, etc.)
      if (frame.type === 'event') return

      // Step 1: connect response — payload is hello-ok on success
      if (frame.id === 'kw-connect') {
        if (!frame.ok) { done(() => reject(new Error(`gateway connect failed: ${errStr(frame.error)}`))); return }
        sendRequest()
        return
      }

      // Step 2: our actual RPC response
      if (frame.type === 'res' && frame.id === reqId) {
        if (frame.ok) done(() => resolve(frame.payload))
        else done(() => reject(new Error(`gateway '${method}' error: ${errStr(frame.error)}`)))
      }
    }

    ws.onerror = () => done(() => reject(new Error(`WebSocket error calling gateway '${method}'`)))
    ws.onclose = (ev: CloseEvent) => {
      if (!settled && ev.code !== 1000 && ev.code !== 1001) {
        done(() => reject(new Error(`WebSocket closed (${ev.code} ${ev.reason || 'no reason'}) calling '${method}'`)))
      }
    }
  })
}

// Session key: scoped as agent:<id>:<knotworkKey> so it stays in the agent's namespace.
function buildSessionKey(task: AnyObj): string {
  const knotworkKey =
    typeof task.session_name === 'string' && task.session_name.trim()
      ? task.session_name.trim()
      : fallbackKey(task)
  const agentId = String(task.remote_agent_id ?? task.agent_id ?? 'main')
  return knotworkKey.startsWith('agent:') ? knotworkKey : `agent:${agentId}:${knotworkKey}`
}

function fallbackKey(task: AnyObj): string {
  const slug = String(task.agent_key ?? task.remote_agent_id ?? 'agent')
  const wsId = String(task.workspace_id ?? 'ws')
  const runId = task.run_id ? String(task.run_id) : null
  return runId ? `knotwork:${slug}:${wsId}:run:${runId}` : `knotwork:${slug}:${wsId}:main`
}

// Deterministic: same taskId → same key. All operations become retry-safe.
function idempotencyKey(taskId: string): string {
  return `knotwork:task:${taskId}`
}

function latestAssistantMessage(history: AnyObj): string {
  const messages = Array.isArray(history.messages) ? history.messages : []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as AnyObj
    if (String(m.role ?? '').toLowerCase() !== 'assistant') continue
    const c = m.content
    if (typeof c === 'string' && c.trim()) return c.trim()
    if (Array.isArray(c)) {
      const t = (c as AnyObj[]).map((p) => String(p.text ?? '')).filter(Boolean).join('\n').trim()
      if (t) return t
    }
  }
  return ''
}

// Parse the agent's structured ```json-decision block from the end of its final message.
// Returns a TaskResult if the block is present and valid; null if the agent didn't include one
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
  let d: AnyObj
  try { d = JSON.parse(jsonStr) as AnyObj } catch { return null }

  if (d.decision === 'escalate') {
    // The full prose before the decision block is the agent's research output —
    // preserve it so Knotwork can display the complete response in the debug panel.
    const message = text.slice(0, lastFence).trim()
    return {
      type: 'escalation',
      question: typeof d.question === 'string' && d.question.trim()
        ? d.question.trim()
        : 'Need human input',
      options: Array.isArray(d.options) ? (d.options as string[]) : [],
      message: message || undefined,
    }
  }

  // "confident" or any other value → completed
  const rawOutput = typeof d.output === 'string' ? d.output.trim() : ''
  // Use the prose before the decision block as fallback if output field is empty
  const output = rawOutput || text.slice(0, lastFence).trim()
  const next_branch = typeof d.next_branch === 'string' ? d.next_branch : null
  return { type: 'completed', output, next_branch }
}

function parseResult(raw: unknown): TaskResult {
  if (!raw || typeof raw !== 'object') return { type: 'completed', output: String(raw ?? ''), next_branch: null }
  const r = raw as AnyObj
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

export async function executeTask(api: OpenClawApi, task: AnyObj): Promise<TaskResult> {
  const taskId = String(task.task_id ?? '')
  if (!taskId) throw new Error('task missing task_id')

  const gatewayCall = api.gateway?.call
  const { port, token } = getGatewayConfig(api)
  const sKey = buildSessionKey(task)
  const iKey = idempotencyKey(taskId)
  const agentId = String(task.remote_agent_id ?? task.agent_id ?? 'main')

  async function rpc(method: string, params: AnyObj, timeoutMs = 90_000): Promise<unknown> {
    if (typeof gatewayCall === 'function') {
      try {
        return await gatewayCall(method, params)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/missing scope:/i.test(message)) throw error
      }
    }
    return gatewayRpc(port, token, method, params, timeoutMs)
  }

  // 1. Send message — gateway auto-creates session on first call.
  let started: AnyObj
  try {
    started = (await rpc('agent', {
      agentId, sessionKey: sKey, idempotencyKey: iKey,
      message: String(task.user_prompt ?? ''),
      extraSystemPrompt: String(task.system_prompt ?? ''),
    })) as AnyObj
  } catch (e) {
    throw new Error(`gateway 'agent' failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  // 2. Sync — wait for completion via runId, then read output from chat history.
  const runId = [started.runId, started.run_id, started.id].find((v) => typeof v === 'string' && v)
  if (!runId) return parseResult(started)

  const waited = (await rpc(
    'agent.wait',
    { runId, timeoutMs: AGENT_WAIT_TIMEOUT_MS },
    AGENT_WAIT_RPC_TIMEOUT_MS,
  )) as AnyObj
  const status = String(waited.status ?? '')
  if (status === 'ok') {
    const history = (await rpc('chat.history', { sessionKey: sKey, limit: 50 }, 10_000)) as AnyObj
    const lastMsg = latestAssistantMessage(history)
    // Prefer the agent's explicit decision block; fall back to treating the full message as output.
    return parseDecisionBlock(lastMsg) ?? { type: 'completed', output: lastMsg, next_branch: null }
  }
  if (status === 'error') return { type: 'failed', error: String(waited.error ?? waited.summary ?? 'agent error') }
  if (status === 'timeout') {
    // Fallback: query chat transcript before failing. In some environments
    // wait can timeout while the response is already present in session history.
    try {
      const history = (await rpc('chat.history', { sessionKey: sKey, limit: 50 }, 10_000)) as AnyObj
      const lastMsg = latestAssistantMessage(history)
      if (lastMsg) {
        return parseDecisionBlock(lastMsg) ?? { type: 'completed', output: lastMsg, next_branch: null }
      }
    } catch {
      // Ignore fallback history errors and return timeout failure below.
    }
    return { type: 'failed', error: `agent timed out after ${Math.floor(AGENT_WAIT_TIMEOUT_MS / 1000)}s` }
  }
  return parseResult(waited)
}

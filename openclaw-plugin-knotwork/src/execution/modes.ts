import type { AnyObj, OpenClawApi } from '../types'
import { pick } from '../utils'
import { extractHistoryCount, extractLastMessageRole, extractLatestAssistantMessage } from './history'
import { resolveGatewayPort, resolveGatewayToken, runGatewayCli } from './gateway'
import { extractOutputText, normalizeExecutionResult } from './normalize'
import { buildSessionIntent } from './session'

export async function runViaGatewayMethod(api: OpenClawApi, task: AnyObj): Promise<AnyObj | null> {
  if (!api.gateway || typeof api.gateway.call !== 'function') return null

  const intent = buildSessionIntent(task)
  if (!intent) return null

  const started = await api.gateway.call('agent', {
    idempotencyKey: intent.idempotencyKey,
    agentId: intent.agentId,
    message: intent.message,
    extraSystemPrompt: intent.extraSystemPrompt,
    sessionKey: intent.scopedSessionKey,
  })

  const runId = pick((started as AnyObj) || {}, ['runId', 'run_id', 'id'])
  if (!runId) return normalizeExecutionResult(started)

  const waited = (await api.gateway.call('agent.wait', {
    runId,
    timeoutMs: 120000,
  })) as AnyObj

  const status = String(pick(waited, ['status']) || '')
  if (status === 'ok') {
    const history = (await api.gateway.call('chat.history', {
      sessionKey: intent.scopedSessionKey,
      limit: 80,
    })) as AnyObj
    const output = extractLatestAssistantMessage(history)
    if (output) return { type: 'completed', output }
  }
  if (status === 'error') {
    return { type: 'failed', error: String(pick(waited, ['error', 'summary']) || 'agent execution failed') }
  }
  if (status === 'timeout') {
    return { type: 'failed', error: 'agent wait timeout' }
  }
  return normalizeExecutionResult(waited)
}

export async function runViaGatewayCliSession(api: OpenClawApi, task: AnyObj): Promise<AnyObj | null> {
  const intent = buildSessionIntent(task)
  if (!intent) return null

  const baselineHistory = await runGatewayCli(
    api,
    'chat.history',
    {
      sessionKey: intent.scopedSessionKey,
      limit: 120,
    },
    4000,
  ).catch(() => ({} as AnyObj))

  const baselineAssistant = extractLatestAssistantMessage(baselineHistory)
  const baselineCount = extractHistoryCount(baselineHistory)

  const started = await runGatewayCli(
    api,
    'agent',
    {
      idempotencyKey: intent.idempotencyKey,
      agentId: intent.agentId,
      message: intent.message,
      extraSystemPrompt: intent.extraSystemPrompt,
      sessionKey: intent.scopedSessionKey,
    },
    15000,
  )

  const runId = String(pick(started, ['runId', 'run_id', 'id']) || '').trim()
  if (!runId) {
    const directStatus = String(pick(started, ['status']) || '')
    if (directStatus === 'ok') {
      const history = await runGatewayCli(api, 'chat.history', { sessionKey: intent.scopedSessionKey, limit: 80 }, 10000)
      const output = extractLatestAssistantMessage(history)
      return { type: 'completed', output: output || extractOutputText(started) || '' }
    }
    if (directStatus === 'error') {
      return { type: 'failed', error: String(pick(started, ['error', 'summary']) || 'agent execution failed') }
    }
    return normalizeExecutionResult(started)
  }

  const deadline = Date.now() + 75000
  let waited: AnyObj = {}
  while (Date.now() < deadline) {
    const history = await runGatewayCli(
      api,
      'chat.history',
      {
        sessionKey: intent.scopedSessionKey,
        limit: 120,
      },
      4000,
    ).catch(() => ({} as AnyObj))

    const latestAssistant = extractLatestAssistantMessage(history)
    const lastRole = extractLastMessageRole(history)
    const currentCount = extractHistoryCount(history)

    if (latestAssistant && latestAssistant !== baselineAssistant) {
      return { type: 'completed', output: latestAssistant }
    }
    if (currentCount > baselineCount && lastRole === 'assistant') {
      return { type: 'completed', output: latestAssistant || '' }
    }

    waited = await runGatewayCli(api, 'agent.wait', { runId, timeoutMs: 1000 }, 4000)
    const status = String(pick(waited, ['status']) || '')
    if (status && status !== 'timeout') break
  }

  const status = String(pick(waited, ['status']) || '')
  if (status === 'ok') {
    const history = await runGatewayCli(api, 'chat.history', { sessionKey: intent.scopedSessionKey, limit: 80 }, 20000)
    const output = extractLatestAssistantMessage(history)
    if (output) return { type: 'completed', output }
    const directResult = pick(waited, ['result'])
    if (directResult && typeof directResult === 'object') {
      const extracted = extractOutputText(directResult as AnyObj)
      if (extracted && extracted !== '{}') return { type: 'completed', output: extracted }
    }
    return { type: 'completed', output: '' }
  }

  if (status === 'error') {
    return { type: 'failed', error: String(pick(waited, ['error', 'summary']) || 'agent execution failed') }
  }

  if (status === 'timeout') {
    return { type: 'failed', error: 'agent wait timeout (no final status before deadline)' }
  }

  return normalizeExecutionResult(waited)
}

export async function runViaOpenResponsesHttp(api: OpenClawApi, task: AnyObj, sessionName: string): Promise<AnyObj | null> {
  const port = resolveGatewayPort(api)
  const token = resolveGatewayToken(api)
  const agentId = String(task.remote_agent_id || task.agent_id || 'main')
  const responsesUrl = `http://127.0.0.1:${port}/v1/responses`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-openclaw-session-key': sessionName,
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const responsesBody: AnyObj = {
    model: `openclaw:${agentId}`,
    instructions: String(task.system_prompt || ''),
    input: String(task.user_prompt || ''),
    user: sessionName,
  }

  const abortController = new AbortController()
  const abortTimer = setTimeout(() => abortController.abort(), 15000)
  const responsesRes = await fetch(responsesUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(responsesBody),
    signal: abortController.signal,
  }).finally(() => clearTimeout(abortTimer))

  const responsesText = await responsesRes.text()
  if (responsesRes.ok) {
    try {
      const parsed = responsesText ? (JSON.parse(responsesText) as AnyObj) : {}
      return { type: 'completed', output: extractOutputText(parsed) }
    } catch {
      return { type: 'completed', output: responsesText || '' }
    }
  }

  const chatUrl = `http://127.0.0.1:${port}/v1/chat/completions`
  const chatBody: AnyObj = {
    model: `openclaw:${agentId}`,
    messages: [
      { role: 'system', content: String(task.system_prompt || '') },
      { role: 'user', content: String(task.user_prompt || '') },
    ],
    user: sessionName,
  }

  const chatAbortController = new AbortController()
  const chatAbortTimer = setTimeout(() => chatAbortController.abort(), 15000)
  const chatRes = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(chatBody),
    signal: chatAbortController.signal,
  }).finally(() => clearTimeout(chatAbortTimer))

  const chatText = await chatRes.text()
  if (!chatRes.ok) {
    const tokenState = token ? 'present' : 'missing'
    throw new Error(
      `OpenClaw HTTP execution failed (responses=${responsesRes.status}, chat=${chatRes.status}, token=${tokenState}): ${responsesText.slice(0, 120)} | ${chatText.slice(0, 120)}`,
    )
  }

  try {
    const parsed = chatText ? (JSON.parse(chatText) as AnyObj) : {}
    return { type: 'completed', output: extractOutputText(parsed) }
  } catch {
    return { type: 'completed', output: chatText || '' }
  }
}

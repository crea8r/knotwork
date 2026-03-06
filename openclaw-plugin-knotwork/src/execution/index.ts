import type { AnyObj, OpenClawApi } from '../types'
import { normalizeExecutionResult } from './normalize'
import { runViaGatewayCliSession, runViaGatewayMethod, runViaOpenResponsesHttp } from './modes'
import { resolveSessionName } from './session'

export async function executeWithOpenClaw(api: OpenClawApi, task: AnyObj): Promise<AnyObj> {
  const sessionName = resolveSessionName(task)
  const tried: string[] = []
  const errors: string[] = []

  const viaGatewayMethod = await runViaGatewayMethod(api, task).catch((err) => {
    errors.push(`gateway-method:${String((err as Error)?.message || err)}`)
    return null
  })
  tried.push('gateway-method')
  if (viaGatewayMethod) return viaGatewayMethod

  const viaGatewayCli = await runViaGatewayCliSession(api, task).catch((err) => {
    errors.push(`gateway-cli-session:${String((err as Error)?.message || err)}`)
    return null
  })
  tried.push('gateway-cli-session')
  if (viaGatewayCli) return viaGatewayCli

  const viaHttpCompat = await runViaOpenResponsesHttp(api, task, sessionName).catch((err) => {
    errors.push(`http-compat:${String((err as Error)?.message || err)}`)
    return null
  })
  tried.push('http-compat')
  if (viaHttpCompat) return viaHttpCompat

  // Legacy fallback path for old runtimes.
  const legacyPayload: AnyObj = {
    agent_id: task.remote_agent_id,
    remote_agent_id: task.remote_agent_id,
    agent_ref: task.agent_ref,
    session_name: sessionName,
    session_id: sessionName,
    session: sessionName,
    sessionId: sessionName,
    conversation_id: sessionName,
    conversationId: sessionName,
    thread_id: sessionName,
    threadId: sessionName,
    system_prompt: task.system_prompt,
    user_prompt: task.user_prompt,
    session_token: task.session_token,
    run_id: task.run_id,
    node_id: task.node_id,
  }

  if (typeof api.runAgent === 'function') {
    tried.push('runAgent')
    return normalizeExecutionResult(await api.runAgent(legacyPayload))
  }

  if (api.agents && typeof api.agents.run === 'function') {
    tried.push('agents.run')
    return normalizeExecutionResult(await api.agents.run(legacyPayload))
  }

  if (api.gateway && typeof api.gateway.call === 'function') {
    tried.push('gateway.call(agents.run)')
    return normalizeExecutionResult(await api.gateway.call('agents.run', legacyPayload))
  }

  const apiShape = `runAgent=${typeof api.runAgent},agents.run=${typeof api.agents?.run},gateway.call=${typeof api.gateway?.call}`
  const detail = errors.length ? ` errors=${errors.join(' ; ')}` : ''
  throw new Error(`No OpenClaw execution API found (tried: ${tried.join(', ')}; ${apiShape}).${detail}`)
}

export { normalizeExecutionResult } from './normalize'
export { resolveSessionName } from './session'

import type { ActionEnvelope, ActionItem } from './types'

const ACTION_FENCE = '```json-action'

type ParseHints = {
  defaultKnowledgePath?: string | null
}

function extractActionJson(rawOutput: string): string {
  const text = String(rawOutput ?? '').trim()
  const start = text.lastIndexOf(ACTION_FENCE)
  if (start === -1) throw new Error('missing ```json-action block')
  const newline = text.indexOf('\n', start)
  if (newline === -1) throw new Error('invalid json-action opening fence')
  const end = text.indexOf('```', newline + 1)
  if (end === -1) throw new Error('missing closing ``` fence for json-action block')
  return text.slice(newline + 1, end).trim()
}

function assertActionItem(value: unknown, index: number): ActionItem {
  if (!value || typeof value !== 'object') throw new Error(`action[${index}] must be an object`)
  const action = value as Record<string, unknown>
  const actionId = String(action.action_id ?? '').trim()
  const type = String(action.type ?? '').trim()
  if (!actionId) throw new Error(`action[${index}] missing action_id`)
  if (!type) throw new Error(`action[${index}] missing type`)
  if (type === 'channel.post_message') {
    const target = action.target as Record<string, unknown> | undefined
    const payload = action.payload as Record<string, unknown> | undefined
    const channelId = String(target?.channel_id ?? '').trim()
    const content = String(payload?.content ?? '').trim()
    if (!channelId) throw new Error(`action[${index}] channel.post_message missing target.channel_id`)
    if (!content) throw new Error(`action[${index}] channel.post_message missing payload.content`)
  } else if (type === 'escalation.resolve') {
    const target = action.target as Record<string, unknown> | undefined
    const payload = action.payload as Record<string, unknown> | undefined
    const escalationId = String(target?.escalation_id ?? '').trim()
    const resolution = String(payload?.resolution ?? '').trim()
    if (!escalationId) throw new Error(`action[${index}] escalation.resolve missing target.escalation_id`)
    if (!['accept_output', 'override_output', 'request_revision', 'abort_run'].includes(resolution)) {
      throw new Error(`action[${index}] escalation.resolve has invalid payload.resolution`)
    }
  } else if (type === 'knowledge.propose_change') {
    const target = action.target as Record<string, unknown> | undefined
    const payload = action.payload as Record<string, unknown> | undefined
    const path = String(target?.path ?? '').trim()
    const proposedContent = String(payload?.proposed_content ?? '').trim()
    const reason = String(payload?.reason ?? '').trim()
    if (!path) throw new Error(`action[${index}] knowledge.propose_change missing target.path`)
    if (!proposedContent) throw new Error(`action[${index}] knowledge.propose_change missing payload.proposed_content`)
    if (!reason) throw new Error(`action[${index}] knowledge.propose_change missing payload.reason`)
  } else if (type === 'control.noop' || type === 'control.fail') {
    const payload = action.payload as Record<string, unknown> | undefined
    const reason = String(payload?.reason ?? '').trim()
    if (!reason) throw new Error(`action[${index}] ${type} missing payload.reason`)
  } else {
    throw new Error(`unsupported action type: ${type}`)
  }
  return action as unknown as ActionItem
}

function normalizeShorthandEnvelope(env: Record<string, unknown>, hints?: ParseHints): ActionEnvelope | null {
  const actionType = String(env.action ?? '').trim()
  if (!actionType) return null

  let action: ActionItem
  if (actionType === 'channel.post_message') {
    const channelId = String(env.channel_id ?? '').trim()
    const payload = (env.payload ?? {}) as Record<string, unknown>
    const content = String(payload.content ?? '').trim()
    if (!channelId || !content) throw new Error('shorthand channel.post_message requires channel_id and payload.content')
    action = {
      action_id: 'action-1',
      type: 'channel.post_message',
      target: { channel_id: channelId },
      payload: {
        content,
        author_name: typeof payload.author_name === 'string' ? payload.author_name : undefined,
        run_id: typeof payload.run_id === 'string' ? payload.run_id : null,
      },
    }
  } else if (actionType === 'control.noop') {
    action = {
      action_id: 'action-1',
      type: 'control.noop',
      target: {},
      payload: { reason: typeof env.reason === 'string' && env.reason.trim() ? env.reason.trim() : 'noop' },
    }
  } else if (actionType === 'control.fail') {
    action = {
      action_id: 'action-1',
      type: 'control.fail',
      target: {},
      payload: { reason: typeof env.reason === 'string' && env.reason.trim() ? env.reason.trim() : 'failed' },
    }
  } else if (actionType === 'escalation.resolve') {
    const escalationId = String(env.escalation_id ?? '').trim()
    const resolution = String(env.resolution ?? '').trim()
    if (!escalationId || !['accept_output', 'override_output', 'request_revision', 'abort_run'].includes(resolution)) {
      throw new Error('shorthand escalation.resolve requires escalation_id and valid resolution')
    }
    action = {
      action_id: 'action-1',
      type: 'escalation.resolve',
      target: { escalation_id: escalationId },
      payload: {
        resolution: resolution as 'accept_output' | 'override_output' | 'request_revision' | 'abort_run',
        guidance: typeof env.guidance === 'string' ? env.guidance : undefined,
        override_output: (env.override_output ?? null) as Record<string, unknown> | null,
        next_branch: typeof env.next_branch === 'string' ? env.next_branch : null,
        answers: Array.isArray(env.answers) ? env.answers.map((item) => String(item)) : null,
        channel_id: typeof env.channel_id === 'string' ? env.channel_id : null,
      },
    }
  } else if (actionType === 'knowledge.propose_change') {
    const path = String(env.path ?? hints?.defaultKnowledgePath ?? '').trim()
    const payload = (env.payload ?? {}) as Record<string, unknown>
    const proposedContent = String(env.proposed_content ?? payload.proposed_content ?? '').trim()
    const reason = String(env.reason ?? payload.reason ?? '').trim()
    if (!path || !proposedContent || !reason) {
      throw new Error('shorthand knowledge.propose_change requires path, proposed_content, and reason')
    }
    action = {
      action_id: 'action-1',
      type: 'knowledge.propose_change',
      target: { path },
      payload: {
        proposed_content: proposedContent,
        reason,
        run_id: typeof env.run_id === 'string' ? env.run_id : undefined,
        node_id: typeof env.node_id === 'string' ? env.node_id : undefined,
        agent_ref: typeof env.agent_ref === 'string' ? env.agent_ref : null,
        source_channel_id: typeof env.source_channel_id === 'string' ? env.source_channel_id : null,
        action_type: typeof env.action_type === 'string' ? env.action_type : undefined,
        target_type: typeof env.target_type === 'string' ? env.target_type : undefined,
        payload: typeof payload === 'object' ? payload : {},
      },
    }
  } else {
    throw new Error(`unsupported shorthand action type: ${actionType}`)
  }

  return {
    protocol_version: 'knotwork.action/v1',
    kind: 'action_batch',
    idempotency_key: String(env.idempotency_key ?? 'shorthand'),
    source: {
      agent_id: String(env.agent_id ?? 'unknown'),
      session_key: String(env.session_key ?? 'unknown'),
      task_id: String(env.task_id ?? 'unknown'),
    },
    context: {
      workspace_id: typeof env.workspace_id === 'string' ? env.workspace_id : null,
      trigger: { type: typeof env.trigger_type === 'string' ? env.trigger_type : 'unknown' },
    },
    actions: [action],
    completion: {
      task_status: actionType === 'control.fail' ? 'failed' : 'completed',
      archive_trigger_delivery: true,
    },
  }
}

export function parseActionEnvelope(rawOutput: string, hints?: ParseHints): ActionEnvelope {
  const json = extractActionJson(rawOutput)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`invalid json-action payload: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('action envelope must be an object')
  const env = parsed as Record<string, unknown>
  const shorthand = normalizeShorthandEnvelope(env, hints)
  if (shorthand) return shorthand
  if (env.protocol_version !== 'knotwork.action/v1') throw new Error('unsupported protocol_version')
  if (env.kind !== 'action_batch') throw new Error('unsupported action batch kind')
  const idempotencyKey = String(env.idempotency_key ?? '').trim()
  if (!idempotencyKey) throw new Error('missing idempotency_key')
  if (!Array.isArray(env.actions) || env.actions.length === 0) throw new Error('actions must be a non-empty array')
  const actions = env.actions.map((item, index) => assertActionItem(item, index))
  const completion = env.completion as Record<string, unknown> | undefined
  const taskStatus = String(completion?.task_status ?? '').trim()
  if (taskStatus !== 'completed' && taskStatus !== 'failed') throw new Error('completion.task_status must be completed or failed')
  return {
    protocol_version: 'knotwork.action/v1',
    kind: 'action_batch',
    idempotency_key: idempotencyKey,
    source: (env.source ?? {}) as ActionEnvelope['source'],
    context: (env.context ?? {}) as ActionEnvelope['context'],
    intent: (env.intent ?? undefined) as ActionEnvelope['intent'],
    actions,
    completion: {
      task_status: taskStatus,
      archive_trigger_delivery: Boolean(completion?.archive_trigger_delivery),
    },
  }
}

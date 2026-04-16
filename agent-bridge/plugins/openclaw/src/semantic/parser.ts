import type { MCPContractManifest, WorkPacket } from '../types'
import type { ActionEnvelope, ActionItem } from './types'

const ACTION_FENCE = '```json-action'

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

function validateSchema(value: unknown, schema: Record<string, unknown>, path: string): void {
  const expectedType = schema.type
  if (expectedType === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
    const objectValue = value as Record<string, unknown>
    const properties = (schema.properties && typeof schema.properties === 'object') ? schema.properties as Record<string, Record<string, unknown>> : {}
    const required = Array.isArray(schema.required) ? schema.required.map((item) => String(item)) : []
    for (const key of required) {
      if (!(key in objectValue)) throw new Error(`${path}.${key} is required`)
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in objectValue) validateSchema(objectValue[key], propSchema, `${path}.${key}`)
    }
    if (schema.additionalProperties === false) {
      const extras = Object.keys(objectValue).filter((key) => !(key in properties))
      if (extras.length > 0) throw new Error(`${path} has unexpected properties: ${extras.join(', ')}`)
    }
    return
  }
  if (expectedType === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
    const itemSchema = (schema.items && typeof schema.items === 'object') ? schema.items as Record<string, unknown> : null
    if (itemSchema) {
      value.forEach((item, index) => validateSchema(item, itemSchema, `${path}[${index}]`))
    }
    return
  }
  if (expectedType === 'string') {
    if (typeof value !== 'string') throw new Error(`${path} must be a string`)
    const enumValues = Array.isArray(schema.enum) ? schema.enum.map((item) => String(item)) : null
    if (enumValues && !enumValues.includes(value)) throw new Error(`${path} must be one of: ${enumValues.join(', ')}`)
  }
}

function protocolActionMap(packet: WorkPacket & { mcp_contract: MCPContractManifest }): Map<string, { target_schema: Record<string, unknown>; payload_schema: Record<string, unknown> }> {
  return new Map(
    packet.mcp_contract.actions.map((action) => [
      action.name,
      {
        target_schema: action.target_schema,
        payload_schema: action.payload_schema,
      },
    ]),
  )
}

function assertActionItem(value: unknown, index: number, packet: WorkPacket & { mcp_contract: MCPContractManifest }): ActionItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`action[${index}] must be an object`)
  const action = value as Record<string, unknown>
  const actionId = String(action.action_id ?? '').trim()
  const type = String(action.type ?? '').trim()
  if (!actionId) throw new Error(`action[${index}] missing action_id`)
  if (!type) throw new Error(`action[${index}] missing type`)
  if (!packet.mcp_contract.allowed_actions.includes(type)) throw new Error(`action[${index}] uses unsupported action type: ${type}`)
  const definition = protocolActionMap(packet).get(type)
  if (!definition) throw new Error(`action[${index}] is missing protocol schema for ${type}`)
  validateSchema(action.target, definition.target_schema, `action[${index}].target`)
  validateSchema(action.payload, definition.payload_schema, `action[${index}].payload`)
  return {
    action_id: actionId,
    type,
    target: (action.target ?? {}) as Record<string, unknown>,
    payload: (action.payload ?? {}) as Record<string, unknown>,
  }
}

function normalizeShorthandEnvelope(env: Record<string, unknown>, packet: WorkPacket & { mcp_contract: MCPContractManifest }): ActionEnvelope | null {
  const actionType = String(env.action ?? '').trim()
  if (!actionType) return null
  if (!packet.mcp_contract.allowed_actions.includes(actionType)) throw new Error(`unsupported shorthand action type: ${actionType}`)
  const target = (env.target && typeof env.target === 'object' && !Array.isArray(env.target)) ? env.target as Record<string, unknown> : {}
  const payload = (env.payload && typeof env.payload === 'object' && !Array.isArray(env.payload)) ? env.payload as Record<string, unknown> : {}
  const action: ActionItem = assertActionItem({
    action_id: 'action-1',
    type: actionType,
    target,
    payload,
  }, 0, packet)
  return {
    protocol_version: 'knotwork.action/v1',
    kind: 'action_batch',
    idempotency_key: String(env.idempotency_key ?? 'shorthand'),
    source: {
      agent_id: String(env.agent_id ?? packet.agent.participant_id ?? 'unknown'),
      session_key: String(env.session_key ?? packet.continuation_key.id ?? packet.task_id),
      task_id: String(env.task_id ?? packet.task_id),
    },
    context: {
      workspace_id: packet.workspace.id,
      trigger: packet.trigger,
    },
    actions: [action],
    completion: {
      task_status: actionType === 'control.fail' ? 'failed' : 'completed',
      archive_trigger_delivery: true,
    },
  }
}

export function parseActionEnvelope(rawOutput: string, packet: WorkPacket & { mcp_contract: MCPContractManifest }): ActionEnvelope {
  const json = extractActionJson(rawOutput)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error(`invalid json-action payload: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('action envelope must be an object')
  const env = parsed as Record<string, unknown>
  const shorthand = normalizeShorthandEnvelope(env, packet)
  if (shorthand) return shorthand
  if (env.protocol_version !== 'knotwork.action/v1') throw new Error('unsupported protocol_version')
  if (env.kind !== 'action_batch') throw new Error('unsupported action batch kind')
  const idempotencyKey = String(env.idempotency_key ?? '').trim()
  if (!idempotencyKey) throw new Error('missing idempotency_key')
  if (!Array.isArray(env.actions) || env.actions.length === 0) throw new Error('actions must be a non-empty array')
  const actions = env.actions.map((item, index) => assertActionItem(item, index, packet))
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

import type { SemanticPreparedInput } from './types'

function requiredKeys(schema: Record<string, unknown>): string[] {
  const required = schema.required
  return Array.isArray(required) ? required.map((item) => String(item)) : []
}

function compactProtocolSummary(input: SemanticPreparedInput): string {
  const contract = input.workPacket.mcp_contract
  const actionLines = contract.actions.map((action) => {
    const target = requiredKeys(action.target_schema)
    const payload = requiredKeys(action.payload_schema)
    const parts = [
      `- \`${action.name}\``,
      `[${action.kind}]`,
      action.context_section ? `section=${action.context_section}` : null,
      target.length > 0 ? `target: ${target.join(', ')}` : null,
      payload.length > 0 ? `payload: ${payload.join(', ')}` : null,
      action.description,
    ].filter(Boolean)
    return parts.join(' ')
  })
  return [
    `Contract: \`${contract.id}\``,
    `Checksum: \`${contract.checksum}\``,
    `Owning module: \`${contract.owning_module}\``,
    '',
    'Actions:',
    ...actionLines,
  ].join('\n')
}

function flowLabel(metadata?: Record<string, unknown> | null): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const flow = metadata.flow
  if (!flow || typeof flow !== 'object') return null
  const fromRole = typeof (flow as Record<string, unknown>).from_role === 'string'
    ? String((flow as Record<string, unknown>).from_role)
    : null
  const toRole = typeof (flow as Record<string, unknown>).to_role === 'string'
    ? String((flow as Record<string, unknown>).to_role)
    : null
  if (!fromRole || !toRole) return null
  return `${fromRole} -> ${toRole}`
}

export function buildSemanticSystemPrompt(input: SemanticPreparedInput): string {
  const packet = input.workPacket
  const policyInstructions = packet.work_policy.instructions.map((line) => `- ${line}`)
  const modeInstructions = packet.task_focus.mode_instructions.map((line) => `- ${line}`)
  const contractInstructions = packet.mcp_contract.instructions.map((line) => `- ${line}`)
  return [
    `You are operating in Knotwork MCP contract mode.`,
    `Your session is private thinking space. Do not use your final output as normal chat.`,
    `Your current session type is: ${packet.session_type}.`,
    `The active MCP contract is ${packet.mcp_contract.id} (checksum ${packet.mcp_contract.checksum}).`,
    packet.task_focus.immediate_instruction ? `Immediate instruction: ${packet.task_focus.immediate_instruction}` : null,
    `Return exactly one fenced block in this format:`,
    '',
    '```json-action',
    '{',
    '  "protocol_version": "knotwork.action/v1",',
    '  "kind": "action_batch",',
    '  "idempotency_key": "unique-key",',
    '  "source": { "agent_id": "agent", "session_key": "session", "task_id": "task" },',
    '  "context": { "workspace_id": "workspace", "trigger": { "type": "..." } },',
    '  "actions": [',
    '    { "action_id": "action-1", "type": "one-of-allowed-actions", "target": {}, "payload": {} }',
    '  ],',
    '  "completion": { "task_status": "completed", "archive_trigger_delivery": true }',
    '}',
    '```',
    '',
    `Rules:`,
    `- Only emit actions listed in allowed_actions.`,
    `- Match each action's target_schema and payload_schema exactly.`,
    `- Use only the runtime contract definition below; do not invent fields or action names.`,
    `- If you need more context, emit a read action only. Do not mix read and write actions in the same batch.`,
    `- If no external action is needed, emit control.noop.`,
    `- If you cannot proceed safely, emit control.fail with a concrete reason.`,
    `- Do not emit markdown or prose outside the json-action block.`,
    '',
    `Work policy:`,
    ...policyInstructions,
    '',
    `Mode rules:`,
    ...modeInstructions,
    '',
    `Contract rules:`,
    ...contractInstructions,
  ].filter((line) => line !== null).join('\n')
}

export function buildSemanticUserPrompt(input: SemanticPreparedInput): string {
  const packet = input.workPacket
  const hasSection = (section: string) => packet.mcp_contract.context_sections.includes(section)
  const readActions = packet.mcp_contract.actions.filter((action) => action.kind === 'read')

  const contractExamples = (packet.mcp_contract.examples ?? []).slice(0, 1).map((example) => [
    `### ${example.summary}`,
    '```json-action',
    JSON.stringify(example.action, null, 2),
    '```',
  ].join('\n')).join('\n\n')

  return [
    `## Immediate Task`,
    `Session type: ${packet.session_type}`,
    `Contract: ${packet.mcp_contract.id}`,
    `Contract checksum: ${packet.mcp_contract.checksum}`,
    packet.task_focus.immediate_instruction ? `Instruction: ${packet.task_focus.immediate_instruction}` : null,
    `Allowed actions: ${packet.mcp_contract.allowed_actions.join(', ')}`,
    '',
    `## Context Strategy`,
    readActions.length > 0
      ? `Available read actions: ${readActions.map((action) => action.name).join(', ')}`
      : 'No read actions are available for this contract.',
    `Use only the loaded context below. If you are blocked, request one more context slice with a read action.`,
    '',
    `## Contract`,
    compactProtocolSummary(input),
    '',
    hasSection('primary_subject') && packet.primary_subject ? `## Primary Subject\n${JSON.stringify(packet.primary_subject, null, 2)}` : null,
    hasSection('primary_subject') && packet.primary_subject ? `` : null,
    hasSection('trigger_message') && packet.trigger_message ? `## Trigger Message\n${[
      flowLabel(packet.trigger_message.metadata) ? `Flow: ${flowLabel(packet.trigger_message.metadata)}` : null,
      packet.trigger_message.content,
    ].filter(Boolean).join('\n')}` : null,
    hasSection('trigger_message') && packet.trigger_message ? `` : null,
    hasSection('recent_messages') && packet.recent_messages.length > 0 ? `## Recent Messages\n${packet.recent_messages.map((message) => {
      const author = message.author_name?.trim() || message.author_type
      const flow = flowLabel(message.metadata)
      const header = flow
        ? `- [${message.created_at}] ${author} (${message.role}, ${flow})`
        : `- [${message.created_at}] ${author} (${message.role})`
      return `${header}\n${message.content}`
    }).join('\n\n')}` : null,
    hasSection('recent_messages') && packet.recent_messages.length > 0 ? `` : null,
    hasSection('asset_summaries') && packet.asset_summaries.length > 0 ? `## Bound Assets\n${JSON.stringify(packet.asset_summaries, null, 2)}` : null,
    hasSection('asset_summaries') && packet.asset_summaries.length > 0 ? `` : null,
    hasSection('graph_summary') && packet.graph_summary ? `## Workflow Summary\n${JSON.stringify(packet.graph_summary, null, 2)}` : null,
    hasSection('graph_summary') && packet.graph_summary ? `` : null,
    hasSection('run_summary') && packet.run_summary ? `## Run Summary\n${JSON.stringify(packet.run_summary, null, 2)}` : null,
    hasSection('run_summary') && packet.run_summary ? `` : null,
    hasSection('request_summary') && packet.request_summary ? `## Active Request\n${JSON.stringify(packet.request_summary, null, 2)}` : null,
    hasSection('request_summary') && packet.request_summary ? `` : null,
    hasSection('request_context') && packet.request_context ? `## Request Context\n${String(packet.request_context)}` : null,
    hasSection('request_context') && packet.request_context ? `` : null,
    hasSection('escalation_summary') && packet.escalation_summary ? `## Escalation Summary\n${JSON.stringify(packet.escalation_summary, null, 2)}` : null,
    hasSection('escalation_summary') && packet.escalation_summary ? `` : null,
    `## Examples`,
    contractExamples || 'No contract examples were provided.',
    '',
    `Focus on the immediate task only. Emit one json-action block for the next observable Knotwork action batch.`,
  ].filter((line) => line !== null).join('\n')
}

import type { SemanticPreparedInput, TaskPhaseResult } from './types'

function requiredKeys(schema: Record<string, unknown>): string[] {
  const required = schema.required
  return Array.isArray(required) ? required.map((item) => String(item)) : []
}

function compactActionLine(action: SemanticPreparedInput['workPacket']['mcp_contract']['actions'][number]): string {
  const target = requiredKeys(action.target_schema)
  const payload = requiredKeys(action.payload_schema)
  const noTargetFields = action.target_schema?.type === 'object' && target.length === 0
  const noPayloadFields = action.payload_schema?.type === 'object' && payload.length === 0
  const parts = [
    `- \`${action.name}\``,
    `[${action.kind}]`,
    action.context_section ? `loads ${action.context_section}` : null,
    noTargetFields ? `target={}` : (target.length > 0 ? `target: ${target.join(', ')}` : null),
    noPayloadFields ? `payload={}` : (payload.length > 0 ? `payload: ${payload.join(', ')}` : null),
    action.description,
  ].filter(Boolean)
  return parts.join(' ')
}

function uniqueLines(lines: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const text = String(line ?? '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function compactText(value: string, maxChars: number): string {
  const text = String(value ?? '').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
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

function baseTaskParagraph(input: SemanticPreparedInput): string {
  const packet = input.workPacket
  const instruction = String(
    packet.task_focus.immediate_instruction
      ?? packet.trigger.subtitle
      ?? packet.trigger.title
      ?? 'Handle the current Knotwork task.',
  ).replace(/\s+/g, ' ').trim()
  return instruction ? `Task: ${instruction}` : 'Task: Handle the current Knotwork task.'
}

function commonContextSections(input: SemanticPreparedInput): Array<string | null> {
  const packet = input.workPacket
  const hasSection = (section: string) => packet.mcp_contract.context_sections.includes(section)
  return [
    hasSection('primary_subject') && packet.primary_subject ? `## Primary Subject\n${JSON.stringify(packet.primary_subject, null, 2)}` : null,
    hasSection('recent_messages') && packet.recent_messages.length > 0 ? `## Recent Messages\n${packet.recent_messages.map((message) => {
      const author = message.author_name?.trim() || message.author_type
      const flow = flowLabel(message.metadata)
      const header = flow
        ? `- [${message.created_at}] ${author} (${message.role}, ${flow})`
        : `- [${message.created_at}] ${author} (${message.role})`
      return `${header}\n${message.content}`
    }).join('\n\n')}` : null,
    hasSection('asset_summaries') && packet.asset_summaries.length > 0 ? `## Bound Assets\n${JSON.stringify(packet.asset_summaries, null, 2)}` : null,
    hasSection('graph_summary') && packet.graph_summary ? `## Graph Summary\n${JSON.stringify(packet.graph_summary, null, 2)}` : null,
    hasSection('run_summary') && packet.run_summary ? `## Run Summary\n${JSON.stringify(packet.run_summary, null, 2)}` : null,
    hasSection('request_summary') && packet.request_summary ? `## Request Summary\n${JSON.stringify(packet.request_summary, null, 2)}` : null,
    hasSection('request_context') && packet.request_context ? `## Request Context\n${String(packet.request_context)}` : null,
    hasSection('escalation_summary') && packet.escalation_summary ? `## Escalation Summary\n${JSON.stringify(packet.escalation_summary, null, 2)}` : null,
  ]
}

function schemaHint(name: string, schema: Record<string, unknown>): string | null {
  const type = schema.type
  if (type === 'string') {
    const enumValues = Array.isArray(schema.enum) ? schema.enum.map((item) => String(item)) : []
    return enumValues.length > 0
      ? `- \`${name}\` must be one of: ${enumValues.join(', ')}`
      : `- \`${name}\` must be a string.`
  }
  if (type === 'array') {
    const itemSchema = schema.items && typeof schema.items === 'object' ? schema.items as Record<string, unknown> : null
    const itemType = itemSchema?.type
    return itemType
      ? `- \`${name}\` must be an array of ${String(itemType)} values.`
      : `- \`${name}\` must be an array.`
  }
  if (type === 'object') {
    const required = requiredKeys(schema)
    return required.length > 0
      ? `- \`${name}\` must be an object with required keys: ${required.join(', ')}.`
      : `- \`${name}\` must be an object.`
  }
  return null
}

function summarizeTaskPhaseResult(result: TaskPhaseResult): string {
  const compact = compactText(result.result, 2200)
  if (compact.startsWith('{') || compact.startsWith('[')) {
    return ['```json', compact, '```'].join('\n')
  }
  const lines = compact
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const bullets = lines.slice(0, 8).map((line) => `- ${compactText(line, 220)}`)
  return bullets.join('\n')
}

function genericSchemaHints(input: SemanticPreparedInput): string[] {
  const lines: string[] = []
  for (const action of input.workPacket.mcp_contract.actions) {
    const targetHint = schemaHint(`${action.name}.target`, action.target_schema)
    const payloadHint = schemaHint(`${action.name}.payload`, action.payload_schema)
    if (targetHint) lines.push(targetHint)
    if (payloadHint) lines.push(payloadHint)
  }
  return uniqueLines(lines)
}

export function buildTaskPhaseSystemPrompt(input: SemanticPreparedInput): string {
  const packet = input.workPacket
  const guidance = uniqueLines([
    ...packet.task_focus.mode_instructions,
    ...packet.mcp_contract.instructions,
  ])
  const readActions = packet.mcp_contract.actions.filter((action) => action.kind === 'read')
  return [
    `You are working inside Knotwork, but Phase 1 is for doing the task, not formatting Knotwork actions.`,
    `Use your own private tools for research, browsing, analysis, and normal work.`,
    `Use Knotwork read actions only when you truly need more Knotwork context.`,
    `Return exactly one fenced block in this format:`,
    '',
    '```json-task',
    '{',
    '  "type": "result | read_request | fail",',
    '  "reasoning": "brief explanation",',
    '  "result": "task result text when type=result",',
    '  "confidence": 0.0,',
    '  "action": "one-knotwork-read-action when type=read_request",',
    '  "target": {},',
    '  "payload": {},',
    '  "error": "failure reason when type=fail"',
    '}',
    '```',
    '',
    `Rules:`,
    `- Do the task in Phase 1. Do not format the final Knotwork action yet.`,
    `- If the loaded context is enough, return \`type: "result"\`.`,
    `- Use \`type: "read_request"\` only when you need one more Knotwork context read.`,
    `- Use only Knotwork read actions listed below for \`read_request\`.`,
    `- Match the read action target and payload shapes exactly.`,
    `- If the task cannot be completed safely, return \`type: "fail"\` with a concrete reason.`,
    `- Do not emit markdown or prose outside the json-task block.`,
    '',
    `Available Knotwork read actions:`,
    ...readActions.map((action) => compactActionLine(action)),
    '',
    guidance.length > 0 ? `Contract guidance:` : null,
    ...guidance.map((line) => `- ${line}`),
  ].filter((line) => line !== null).join('\n')
}

export function buildTaskPhaseUserPrompt(input: SemanticPreparedInput): string {
  return [
    baseTaskParagraph(input),
    '',
    ...commonContextSections(input),
    '',
    `Complete the task. If you truly need more Knotwork context, request exactly one read. Otherwise return the completed task result.`,
  ].filter((line) => line !== null).join('\n')
}

export function buildActionPhaseSystemPrompt(input: SemanticPreparedInput): string {
  const packet = input.workPacket
  const guidance = uniqueLines([
    ...packet.task_focus.mode_instructions,
    ...packet.mcp_contract.instructions,
  ])
  const actionLines = packet.mcp_contract.actions.map((action) => compactActionLine(action))
  const schemaHints = genericSchemaHints(input)
  return [
    `You are now in Phase 2.`,
    `The task work is already completed. Your only job is to map the completed result into the next Knotwork action.`,
    `Return exactly one fenced block in this format:`,
    '',
    '```json-action',
    '{',
    '  "reasoning": "brief explanation of why this is the right next Knotwork action",',
    '  "action": "one-knotwork-action-type",',
    '  "target": {},',
    '  "payload": {}',
    '}',
    '```',
    '',
    `Rules:`,
    `- Do not redo the task work in Phase 2.`,
    `- Choose the single best next Knotwork action using the completed task result.`,
    `- Use only Knotwork action types listed below.`,
    `- Match the target and payload fields exactly.`,
    `- Follow the contract examples and schema hints below.`,
    `- Do not emit markdown or prose outside the json-action block.`,
    '',
    `Available Knotwork actions:`,
    ...actionLines,
    '',
    schemaHints.length > 0 ? `Schema hints:` : null,
    ...schemaHints,
    '',
    guidance.length > 0 ? `Contract guidance:` : null,
    ...guidance.map((line) => `- ${line}`),
  ].filter((line) => line !== null).join('\n')
}

export function buildActionPhaseUserPrompt(
  input: SemanticPreparedInput,
  result: TaskPhaseResult,
  formatError?: string | null,
): string {
  const packet = input.workPacket
  const examples = packet.mcp_contract.examples ?? []
  const preferredExamples = examples
    .filter((example) => !String(example.action?.action ?? '').startsWith('context.get_'))
    .slice(0, 2)
  const chosenExamples = preferredExamples.length > 0 ? preferredExamples : examples.slice(0, 2)
  const contractExamples = chosenExamples.map((example) => [
    `### ${example.summary}`,
    '```json-action',
    JSON.stringify({
      reasoning: 'Explain briefly why this is the right next Knotwork action.',
      ...example.action,
    }, null, 2),
    '```',
  ].join('\n')).join('\n\n')

  return [
    baseTaskParagraph(input),
    '',
    `## Completed Task Result Summary`,
    result.reasoning ? `Reasoning: ${result.reasoning}` : null,
    typeof result.confidence === 'number' ? `Confidence: ${result.confidence}` : null,
    summarizeTaskPhaseResult(result),
    '',
    ...commonContextSections(input),
    '',
    formatError ? `## Validation Error From Previous Phase 2 Attempt\n${formatError}` : null,
    formatError ? '' : null,
    `## Examples`,
    contractExamples || 'No contract examples were provided.',
    '',
    `Map the completed task result into the single best next Knotwork action.`,
  ].filter((line) => line !== null).join('\n')
}

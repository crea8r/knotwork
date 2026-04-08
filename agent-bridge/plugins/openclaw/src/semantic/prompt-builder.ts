import type { SemanticPreparedInput } from './types'

const MAX_CHANNEL_MESSAGES = 20

export function buildSemanticSystemPrompt(input: SemanticPreparedInput): string {
  const basePrompt = String(input.task.systemPrompt ?? '').trim()
  const protocolPrompt = [
    `You are operating in Knotwork action-protocol mode.`,
    `Your session is private thinking space. Do not use your final output as normal chat.`,
    `Return exactly one fenced block in this format:`,
    ``,
    '```json-action',
    '{ ...valid JSON... }',
    '```',
    ``,
    `Rules:`,
    `- Only emit actions permitted by the capability snapshot.`,
    `- User-facing text is allowed only inside action payloads such as channel.post_message.payload.content.`,
    `- For workflow consultation channels, use graph.apply_delta when the user is asking you to create or modify the workflow itself.`,
    `- Only use graph.update_root_draft when you must replace the entire workflow definition explicitly.`,
    `- After you change a workflow draft, also emit channel.post_message summarizing what changed so the UI refreshes and the user sees the result.`,
    `- For message_posted events, follow the Message Response Policy exactly.`,
    `- If a message mentions another member and not you, emit control.noop.`,
    `- If a message mentions nobody, answer only when you were already involved or when the message clearly matches your role/objective/contribution brief.`,
    `- If no external action is needed, emit control.noop.`,
    `- If you cannot proceed safely, emit control.fail with a concrete reason.`,
    `- Do not emit markdown or prose outside the json-action block.`,
    `- If a single file asset is bound to the channel and you propose a knowledge change, use that file path as the target path unless the user says otherwise.`,
  ].join('\n')
  return [basePrompt, protocolPrompt].filter(Boolean).join('\n\n')
}

export function buildSemanticUserPrompt(input: SemanticPreparedInput): string {
  const recentMessages = input.context.messages
    .slice(-MAX_CHANNEL_MESSAGES)
    .map((message) => {
      const author = message.author_name?.trim() || message.author_type
      return `- [${message.created_at}] ${author} (${message.role})\n${message.content}`
    })
    .join('\n\n')

  return [
    `## Capability Snapshot`,
    JSON.stringify(input.capabilities, null, 2),
    ``,
    `## Available Semantic Actions`,
    `- channel.post_message`,
    `- graph.apply_delta`,
    `- graph.update_root_draft`,
    `- escalation.resolve`,
    `- knowledge.propose_change`,
    `- control.noop`,
    `- control.fail`,
    ``,
    `## Trigger`,
    JSON.stringify(input.task.trigger, null, 2),
    ``,
    input.context.agentSelf ? `## Agent Self\n${JSON.stringify(input.context.agentSelf, null, 2)}` : null,
    input.context.agentSelf ? `` : null,
    input.context.channel ? `## Channel\n${JSON.stringify(input.context.channel, null, 2)}` : null,
    input.context.channel ? `` : null,
    input.context.messageResponsePolicy ? `## Message Response Policy\n${JSON.stringify(input.context.messageResponsePolicy, null, 2)}` : null,
    input.context.messageResponsePolicy ? `` : null,
    input.context.channelParticipants.length > 0 ? `## Channel Participants\n${JSON.stringify(input.context.channelParticipants, null, 2)}` : null,
    input.context.channelParticipants.length > 0 ? `` : null,
    input.context.messages.length > 0 ? `## Recent Channel Messages\n${recentMessages}` : null,
    input.context.messages.length > 0 ? `` : null,
    input.context.channelAssets.length > 0 ? `## Channel Assets\n${JSON.stringify(input.context.channelAssets, null, 2)}` : null,
    input.context.channelAssets.length > 0 ? `` : null,
    input.context.assetContext.knowledgeFiles.length > 0 ? `## Knowledge File Content\n${JSON.stringify(input.context.assetContext.knowledgeFiles, null, 2)}` : null,
    input.context.assetContext.knowledgeFiles.length > 0 ? `` : null,
    input.context.assetContext.folderFiles.length > 0 ? `## Folder Asset Summaries\n${JSON.stringify(input.context.assetContext.folderFiles, null, 2)}` : null,
    input.context.assetContext.folderFiles.length > 0 ? `` : null,
    input.context.assetContext.objectiveChain.length > 0 ? `## Objective Chain Context\nRoot objective first, current objective last:\n${JSON.stringify(input.context.assetContext.objectiveChain, null, 2)}` : null,
    input.context.assetContext.objectiveChain.length > 0 ? `` : null,
    input.context.assetContext.projectDashboard ? `## Project Context\n${JSON.stringify(input.context.assetContext.projectDashboard, null, 2)}` : null,
    input.context.assetContext.projectDashboard ? `` : null,
    input.context.assetContext.graph ? `## Workflow Graph\n${JSON.stringify(input.context.assetContext.graph, null, 2)}` : null,
    input.context.assetContext.graph ? `` : null,
    input.context.assetContext.graphRootDraft ? `## Workflow Root Draft\n${JSON.stringify(input.context.assetContext.graphRootDraft, null, 2)}` : null,
    input.context.assetContext.graphRootDraft ? `` : null,
    input.context.channel?.graph_id ? `## Workflow Editing Rules
- Keep Start and End nodes present as literal ids "start" and "end" whenever the workflow has work nodes.
- Work nodes should usually be type "agent".
- Use top-level node fields like agent_ref, registered_agent_id, operator_id, supervisor_id when you know them.
- Put model instructions and prompts inside node.config.
- If a work node branches to multiple targets, set condition_label on each outgoing edge.
- When creating or substantially changing a workflow, set_input_schema should describe the case data the workflow needs.` : null,
    input.context.channel?.graph_id ? `` : null,
    input.context.assetContext.run ? `## Run Context\n${JSON.stringify(input.context.assetContext.run, null, 2)}` : null,
    input.context.assetContext.run ? `` : null,
    input.context.assetContext.runNodes.length > 0 ? `## Run Nodes\n${JSON.stringify(input.context.assetContext.runNodes, null, 2)}` : null,
    input.context.assetContext.runNodes.length > 0 ? `` : null,
    input.context.assetContext.escalation ? `## Escalation Context\n${JSON.stringify(input.context.assetContext.escalation, null, 2)}` : null,
    input.context.assetContext.escalation ? `` : null,
    `## Action Examples`,
    '```json-action',
    JSON.stringify({
      action: 'channel.post_message',
      channel_id: input.task.channelId ?? input.task.trigger.channel_id ?? 'channel-id',
      payload: { content: 'Visible reply text here.' },
    }, null, 2),
    '```',
    '',
    '```json-action',
    JSON.stringify({
      action: 'graph.apply_delta',
      graph_id: input.context.assetContext.graph?.id ?? input.context.channel?.graph_id ?? 'graph-id',
      note: 'Create the requested workflow structure and wiring.',
      delta: {
        add_nodes: [
          { id: 'start', type: 'start', name: 'Start', config: {} },
          { id: 'draft-brief', type: 'agent', name: 'Draft Brief', config: { system_prompt: 'Draft a brief from the case input.' } },
          { id: 'end', type: 'end', name: 'End', config: {} },
        ],
        add_edges: [
          { id: 'e-start-draft-brief', source: 'start', target: 'draft-brief', type: 'direct' },
          { id: 'e-draft-brief-end', source: 'draft-brief', target: 'end', type: 'direct' },
        ],
        set_input_schema: [
          { name: 'topic', label: 'Topic', description: 'What the brief should cover', required: true, type: 'text' },
        ],
      },
    }, null, 2),
    '```',
    '',
    '```json-action',
    JSON.stringify({
      action: 'knowledge.propose_change',
      path: input.context.assetContext.knowledgeFiles[0]?.path ?? 'handbook/example.md',
      proposed_content: '# Updated content',
      reason: 'Why this change is needed',
    }, null, 2),
    '```',
    '',
    input.context.legacyUserPrompt ? `## Legacy Task Context\n${input.context.legacyUserPrompt}` : null,
    input.context.legacyUserPrompt ? `` : null,
    `## Collaboration Rule`,
    `If another workspace member is better suited to do the work, ask them through channel.post_message content using the normal channel/mention flow. Do not invent a separate delegation action.`,
    ``,
    `Decide the next observable Knotwork action batch. Emit one json-action block only.`,
  ].filter((line) => line !== null).join('\n')
}

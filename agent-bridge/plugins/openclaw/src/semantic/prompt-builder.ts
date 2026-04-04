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
    `- escalation.resolve`,
    `- knowledge.propose_change`,
    `- control.noop`,
    `- control.fail`,
    ``,
    `## Trigger`,
    JSON.stringify(input.task.trigger, null, 2),
    ``,
    input.context.channel ? `## Channel\n${JSON.stringify(input.context.channel, null, 2)}` : null,
    input.context.channel ? `` : null,
    input.context.messages.length > 0 ? `## Recent Channel Messages\n${recentMessages}` : null,
    input.context.messages.length > 0 ? `` : null,
    input.context.channelAssets.length > 0 ? `## Channel Assets\n${JSON.stringify(input.context.channelAssets, null, 2)}` : null,
    input.context.channelAssets.length > 0 ? `` : null,
    input.context.assetContext.knowledgeFiles.length > 0 ? `## Knowledge File Content\n${JSON.stringify(input.context.assetContext.knowledgeFiles, null, 2)}` : null,
    input.context.assetContext.knowledgeFiles.length > 0 ? `` : null,
    input.context.assetContext.folderFiles.length > 0 ? `## Folder Asset Summaries\n${JSON.stringify(input.context.assetContext.folderFiles, null, 2)}` : null,
    input.context.assetContext.folderFiles.length > 0 ? `` : null,
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

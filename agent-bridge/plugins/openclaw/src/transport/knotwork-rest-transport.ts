import {
  archiveInboxDelivery,
  createKnowledgeChange,
  fetchChannel,
  fetchChannelParticipants,
  fetchChannelAssets,
  fetchChannelMessages,
  fetchCurrentMember,
  fetchEscalation,
  fetchGraph,
  fetchGraphRootDraft,
  fetchKnowledgeFile,
  fetchMyChannelSubscriptions,
  fetchObjectiveChain,
  fetchProjectDashboard,
  fetchRun,
  fetchRunNodes,
  listKnowledgeFiles,
  postChannelMessage,
  resolveEscalation,
  updateGraphRootDraft,
} from '../openclaw/bridge'
import type { KnotworkTransport, SemanticCapabilitySnapshot, SemanticThinkingContext } from './contracts'
import type {
  ChannelMessage,
  GraphDraftInfo,
  GraphInfo,
  MessageResponsePolicy,
  ParticipantInfo,
  TaskTrigger,
  WorkspaceMemberInfo,
} from '../types'

function mentionTokens(value: string | null | undefined): string[] {
  return Array.from(String(value ?? '').matchAll(/(?<!\w)@([A-Za-z0-9._-]+)/g)).map((match) => match[1].toLowerCase())
}

function participantAliases(participant: ParticipantInfo): Set<string> {
  const aliases = new Set<string>()
  const add = (value: string | null | undefined) => {
    const normalized = String(value ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '')
    if (normalized) aliases.add(normalized)
  }
  add(participant.mention_handle)
  add(participant.display_name)
  for (const part of String(participant.display_name ?? '').split(/[^A-Za-z0-9._-]+/g)) add(part)
  if (participant.email) add(participant.email.split('@', 1)[0])
  return aliases
}

function metadataParticipantIds(message: ChannelMessage | null): string[] {
  const raw = message?.metadata_?.mentioned_participant_ids
  return Array.isArray(raw) ? raw.map((item) => String(item)).filter(Boolean) : []
}

function findTriggerMessage(trigger: TaskTrigger, messages: ChannelMessage[]): ChannelMessage | null {
  const preview = String(trigger.subtitle ?? '').trim()
  if (preview) {
    const match = [...messages].reverse().find((message) => message.content.startsWith(preview))
    if (match) return match
  }
  return messages[messages.length - 1] ?? null
}

function messageMentionParticipantIds(message: ChannelMessage | null, participants: ParticipantInfo[]): string[] {
  const fromMetadata = metadataParticipantIds(message)
  if (fromMetadata.length > 0) return fromMetadata
  const tokens = new Set(mentionTokens(message?.content))
  if (tokens.size === 0) return []
  return participants
    .filter((participant) => {
      for (const alias of participantAliases(participant)) {
        if (tokens.has(alias)) return true
      }
      return false
    })
    .map((participant) => participant.participant_id)
}

function authoredBySelf(message: ChannelMessage, agentSelf: WorkspaceMemberInfo | null): boolean {
  if (!agentSelf) return false
  const authorParticipantId = message.metadata_?.author_participant_id
  if (typeof authorParticipantId === 'string' && authorParticipantId === agentSelf.participant_id) return true
  return Boolean(message.author_name && message.author_name === agentSelf.name && message.author_type === 'agent')
}

function wasRecentlyInvolved(messages: ChannelMessage[], triggerMessage: ChannelMessage | null, agentSelf: WorkspaceMemberInfo | null): boolean {
  if (!agentSelf) return false
  const triggerIndex = triggerMessage ? messages.findIndex((message) => message.id === triggerMessage.id) : messages.length
  const end = triggerIndex < 0 ? messages.length : triggerIndex
  return messages.slice(Math.max(0, end - 8), end).some((message) => {
    if (authoredBySelf(message, agentSelf)) return true
    return metadataParticipantIds(message).includes(String(agentSelf.participant_id ?? ''))
  })
}

function isTwoMemberDirectChannel(participants: ParticipantInfo[], agentSelf: WorkspaceMemberInfo | null): boolean {
  const selfId = String(agentSelf?.participant_id ?? '')
  if (!selfId) return false
  const activeParticipants = participants.filter((participant) => participant.subscribed !== false)
  return activeParticipants.length === 2 && activeParticipants.some((participant) => participant.participant_id === selfId)
}

function buildMessageResponsePolicy(input: {
  trigger: TaskTrigger
  agentSelf: WorkspaceMemberInfo | null
  participants: ParticipantInfo[]
  messages: ChannelMessage[]
}): MessageResponsePolicy | null {
  if (input.trigger.type !== 'message_posted') return null
  const triggerMessage = findTriggerMessage(input.trigger, input.messages)
  const mentionedParticipantIds = messageMentionParticipantIds(triggerMessage, input.participants)
  const selfId = String(input.agentSelf?.participant_id ?? '')
  const directlyMentionedSelf = Boolean(selfId && mentionedParticipantIds.includes(selfId))
  const mentionedOtherParticipantIds = mentionedParticipantIds.filter((id) => id !== selfId)
  const recentlyInvolved = wasRecentlyInvolved(input.messages, triggerMessage, input.agentSelf)
  const twoMemberDirectChannel = isTwoMemberDirectChannel(input.participants, input.agentSelf)
  if (directlyMentionedSelf) {
    return { decision: 'must_answer', reason: 'message_posted directly mentions this agent', triggerMessageId: triggerMessage?.id ?? null, directlyMentionedSelf, mentionedOtherParticipantIds, mentionedParticipantIds, recentlyInvolved }
  }
  if (mentionedOtherParticipantIds.length > 0) {
    return { decision: 'must_noop', reason: 'message_posted mentions other participant(s), not this agent', triggerMessageId: triggerMessage?.id ?? null, directlyMentionedSelf, mentionedOtherParticipantIds, mentionedParticipantIds, recentlyInvolved }
  }
  if (twoMemberDirectChannel) {
    return { decision: 'must_answer', reason: 'message_posted is in a two-member channel, so the unmentioned message is directed at this agent', triggerMessageId: triggerMessage?.id ?? null, directlyMentionedSelf, mentionedOtherParticipantIds, mentionedParticipantIds, recentlyInvolved }
  }
  return {
    decision: 'model_decides',
    reason: recentlyInvolved
      ? 'message_posted mentions nobody, but this agent was recently involved in the thread'
      : 'message_posted mentions nobody; answer only if clearly in scope for this agent role/objective',
    triggerMessageId: triggerMessage?.id ?? null,
    directlyMentionedSelf,
    mentionedOtherParticipantIds,
    mentionedParticipantIds,
    recentlyInvolved,
  }
}

export class KnotworkRestTransport implements KnotworkTransport {
  constructor(
    private readonly params: {
      baseUrl: string
      workspaceId: string
      jwt: string
      authorName: string
    },
  ) {}

  async getCapabilitySnapshot(trigger: TaskTrigger): Promise<SemanticCapabilitySnapshot> {
    const channelId = typeof trigger.channel_id === 'string' && trigger.channel_id.trim() ? trigger.channel_id.trim() : null
    const subscriptions = await fetchMyChannelSubscriptions(this.params.baseUrl, this.params.workspaceId, this.params.jwt).catch(() => [])
    const activeChannelIds = subscriptions.filter((item) => item.subscribed).map((item) => item.channel_id)
    if (channelId && !activeChannelIds.includes(channelId)) activeChannelIds.push(channelId)
    return {
      workspaceId: this.params.workspaceId,
      agentId: null,
      actions: {
        'channel.post_message': true,
        'graph.apply_delta': true,
        'graph.update_root_draft': true,
        'escalation.resolve': true,
        'knowledge.propose_change': true,
        'control.noop': true,
        'control.fail': true,
      },
      channels: {
        readAllowed: activeChannelIds,
        postAllowed: activeChannelIds,
        signalAllowed: [],
      },
    }
  }

  async loadThinkingContext(trigger: TaskTrigger, legacyUserPrompt?: string): Promise<SemanticThinkingContext> {
    const channelId = typeof trigger.channel_id === 'string' && trigger.channel_id.trim() ? trigger.channel_id.trim() : null
    const effectiveRunIdWithoutChannel = typeof trigger.run_id === 'string' && trigger.run_id.trim() ? trigger.run_id.trim() : null
    if (!channelId) {
      const [run, runNodes, escalation] = await Promise.all([
        effectiveRunIdWithoutChannel
          ? fetchRun(this.params.baseUrl, this.params.workspaceId, this.params.jwt, effectiveRunIdWithoutChannel).catch(() => null)
          : Promise.resolve(null),
        effectiveRunIdWithoutChannel
          ? fetchRunNodes(this.params.baseUrl, this.params.workspaceId, this.params.jwt, effectiveRunIdWithoutChannel).catch(() => [])
          : Promise.resolve([]),
        typeof trigger.escalation_id === 'string' && trigger.escalation_id.trim()
          ? fetchEscalation(this.params.baseUrl, this.params.workspaceId, this.params.jwt, trigger.escalation_id.trim()).catch(() => null)
          : Promise.resolve(null),
      ])
      return {
        trigger,
        agentSelf: await fetchCurrentMember(this.params.baseUrl, this.params.workspaceId, this.params.jwt).catch(() => null),
        channel: null,
        messages: [],
        channelParticipants: [],
        channelAssets: [],
        messageResponsePolicy: null,
        assetContext: {
          knowledgeFiles: [],
          folderFiles: [],
          objectiveChain: [],
          projectDashboard: null,
          graph: null,
          graphRootDraft: null,
          run,
          runNodes,
          escalation,
        },
        legacyUserPrompt: legacyUserPrompt ?? null,
      }
    }

    const [agentSelf, channel, messages, channelParticipants, channelAssets] = await Promise.all([
      fetchCurrentMember(this.params.baseUrl, this.params.workspaceId, this.params.jwt).catch(() => null),
      fetchChannel(this.params.baseUrl, this.params.workspaceId, this.params.jwt, channelId),
      fetchChannelMessages(this.params.baseUrl, this.params.workspaceId, this.params.jwt, channelId),
      fetchChannelParticipants(this.params.baseUrl, this.params.workspaceId, this.params.jwt, channelId).catch(() => []),
      fetchChannelAssets(this.params.baseUrl, this.params.workspaceId, this.params.jwt, channelId).catch(() => []),
    ])

    const fileBindings = channelAssets.filter((binding) => binding.asset_type === 'file' && binding.path)
    const folderBindings = channelAssets.filter((binding) => binding.asset_type === 'folder' && binding.path)
    const projectId = typeof channel.project_id === 'string' && channel.project_id.trim()
      ? channel.project_id.trim()
      : null
    const knowledgeFiles = await Promise.all(
      fileBindings
        .slice(0, 3)
        .map((binding) => fetchKnowledgeFile(this.params.baseUrl, this.params.workspaceId, this.params.jwt, String(binding.path), projectId).catch(() => null)),
    )
    const allKnowledgeFiles = folderBindings.length > 0
      ? await listKnowledgeFiles(this.params.baseUrl, this.params.workspaceId, this.params.jwt, projectId).catch(() => [])
      : []
    const folderFiles = folderBindings.slice(0, 3).map((binding) => {
      const basePath = String(binding.path ?? '').replace(/\/+$/, '')
      const prefix = `${basePath}/`
      return {
        binding,
        files: allKnowledgeFiles.filter((file) => file.path === basePath || file.path.startsWith(prefix)).slice(0, 10),
      }
    })

    const effectiveRunId = typeof trigger.run_id === 'string' && trigger.run_id.trim()
      ? trigger.run_id.trim()
      : channelAssets.find((binding) => binding.asset_type === 'run')?.asset_id ?? null
    const graphId = typeof channel.graph_id === 'string' && channel.graph_id.trim()
      ? channel.graph_id.trim()
      : null
    const objectiveId = typeof channel.objective_id === 'string' && channel.objective_id.trim()
      ? channel.objective_id.trim()
      : null

    const [objectiveChain, projectDashboard, graph, graphRootDraft, run, runNodes, escalation] = await Promise.all([
      objectiveId ? fetchObjectiveChain(this.params.baseUrl, this.params.workspaceId, this.params.jwt, objectiveId).catch(() => []) : Promise.resolve([]),
      projectId ? fetchProjectDashboard(this.params.baseUrl, this.params.workspaceId, this.params.jwt, projectId).catch(() => null) : Promise.resolve(null),
      graphId ? fetchGraph(this.params.baseUrl, this.params.workspaceId, this.params.jwt, graphId).catch(() => null) : Promise.resolve(null),
      graphId ? fetchGraphRootDraft(this.params.baseUrl, this.params.workspaceId, this.params.jwt, graphId).catch(() => null) : Promise.resolve(null),
      effectiveRunId ? fetchRun(this.params.baseUrl, this.params.workspaceId, this.params.jwt, effectiveRunId).catch(() => null) : Promise.resolve(null),
      effectiveRunId ? fetchRunNodes(this.params.baseUrl, this.params.workspaceId, this.params.jwt, effectiveRunId).catch(() => []) : Promise.resolve([]),
      typeof trigger.escalation_id === 'string' && trigger.escalation_id.trim()
        ? fetchEscalation(this.params.baseUrl, this.params.workspaceId, this.params.jwt, trigger.escalation_id.trim()).catch(() => null)
        : Promise.resolve(null),
    ])

    return {
      trigger,
      agentSelf,
      channel,
      messages,
      channelParticipants,
      channelAssets,
      messageResponsePolicy: buildMessageResponsePolicy({
        trigger,
        agentSelf,
        participants: channelParticipants,
        messages,
      }),
      assetContext: {
        knowledgeFiles: knowledgeFiles.filter(Boolean) as SemanticThinkingContext['assetContext']['knowledgeFiles'],
        folderFiles,
        objectiveChain,
        projectDashboard,
        graph: graph as GraphInfo | null,
        graphRootDraft: graphRootDraft as GraphDraftInfo | null,
        run,
        runNodes,
        escalation,
      },
      legacyUserPrompt: legacyUserPrompt ?? null,
    }
  }

  async postChannelMessage(input: {
    channelId: string
    content: string
    authorName: string
    runId?: string | null
  }): Promise<{ messageId: string }> {
    const msg = await postChannelMessage(
      this.params.baseUrl,
      this.params.workspaceId,
      this.params.jwt,
      input.channelId,
      input.content,
      input.authorName || this.params.authorName,
      input.runId ?? undefined,
    )
    return { messageId: msg.id }
  }

  async resolveEscalation(input: {
    escalationId: string
    resolution: string
    actorName: string
    guidance?: string
    overrideOutput?: Record<string, unknown> | null
    nextBranch?: string | null
    answers?: string[] | null
    channelId?: string | null
  }): Promise<{ escalationId: string }> {
    await resolveEscalation(this.params.baseUrl, this.params.workspaceId, this.params.jwt, input.escalationId, {
      resolution: input.resolution,
      actor_name: input.actorName,
      guidance: input.guidance,
      override_output: input.overrideOutput ?? null,
      next_branch: input.nextBranch ?? null,
      answers: input.answers ?? null,
      channel_id: input.channelId ?? null,
    })
    return { escalationId: input.escalationId }
  }

  async proposeKnowledgeChange(input: {
    path: string
    proposedContent: string
    reason: string
    runId?: string
    nodeId?: string
    agentRef?: string | null
    sourceChannelId?: string | null
    actionType?: string
    targetType?: string
    payload?: Record<string, unknown>
  }): Promise<{ proposalId: string; channelId?: string | null }> {
    const result = await createKnowledgeChange(this.params.baseUrl, this.params.workspaceId, this.params.jwt, {
      path: input.path,
      proposed_content: input.proposedContent,
      reason: input.reason,
      run_id: input.runId,
      node_id: input.nodeId,
      agent_ref: input.agentRef ?? null,
      source_channel_id: input.sourceChannelId ?? null,
      action_type: input.actionType,
      target_type: input.targetType,
      payload: input.payload ?? {},
    }) as { id?: string; channel_id?: string | null }

    return {
      proposalId: String(result.id ?? ''),
      channelId: typeof result.channel_id === 'string' ? result.channel_id : null,
    }
  }

  async updateGraphRootDraft(input: {
    graphId: string
    definition: Record<string, unknown>
    note?: string | null
  }): Promise<{ graphId: string; draftId: string | null }> {
    const draft = await updateGraphRootDraft(
      this.params.baseUrl,
      this.params.workspaceId,
      this.params.jwt,
      input.graphId,
      { definition: input.definition },
    )
    return { graphId: input.graphId, draftId: String(draft.id ?? '') || null }
  }

  async archiveDelivery(deliveryId: string): Promise<void> {
    await archiveInboxDelivery(this.params.baseUrl, this.params.workspaceId, this.params.jwt, deliveryId)
  }
}

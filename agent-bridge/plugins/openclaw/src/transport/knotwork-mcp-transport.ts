import { createKnotworkMcpClient, type JsonObject, type KnotworkMcpClient } from '@knotwork/mcp-client'
import type { KnotworkTransport, SemanticCapabilitySnapshot, SemanticThinkingContext } from './contracts'
import type {
  ChannelAssetBinding,
  ChannelInfo,
  ChannelMessage,
  ChannelSubscription,
  EscalationInfo,
  GraphDraftInfo,
  GraphInfo,
  KnowledgeFileSummary,
  KnowledgeFileWithContent,
  MessageResponsePolicy,
  ObjectiveInfo,
  ParticipantInfo,
  ProjectDashboardInfo,
  RunInfo,
  RunNodeStateInfo,
  TaskTrigger,
  WorkspaceMemberInfo,
} from '../types'

type McpTransportParams = {
  baseUrl: string
  workspaceId: string
  jwt: string
  authorName: string
}

function mcpServerUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/mcp`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unwrapMcpTextJson<T>(value: unknown): T {
  if (!isRecord(value) || !Array.isArray(value.content)) return value as T

  const parsed = value.content
    .map((item) => {
      if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') return undefined
      try {
        return JSON.parse(item.text) as unknown
      } catch {
        return item.text
      }
    })
    .filter((item): item is unknown => item !== undefined)

  if (parsed.length === 0) return value as T
  return (parsed.length === 1 ? parsed[0] : parsed) as T
}

async function mcpResult<T>(promise: Promise<unknown>): Promise<T> {
  return unwrapMcpTextJson<T>(await promise)
}

async function mcpList<T>(promise: Promise<unknown>): Promise<T[]> {
  const result = await mcpResult<T[] | T | null>(promise)
  if (result === null || result === undefined) return []
  return Array.isArray(result) ? result : [result]
}

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
  const priorMessages = messages
    .slice(Math.max(0, (triggerIndex < 0 ? messages.length : triggerIndex) - 8), triggerIndex < 0 ? messages.length : triggerIndex)
  return priorMessages.some((message) => {
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

export function buildMessageResponsePolicy(input: {
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
    return {
      decision: 'must_answer',
      reason: 'message_posted directly mentions this agent',
      triggerMessageId: triggerMessage?.id ?? null,
      directlyMentionedSelf,
      mentionedOtherParticipantIds,
      mentionedParticipantIds,
      recentlyInvolved,
    }
  }
  if (mentionedOtherParticipantIds.length > 0) {
    return {
      decision: 'must_noop',
      reason: 'message_posted mentions other participant(s), not this agent',
      triggerMessageId: triggerMessage?.id ?? null,
      directlyMentionedSelf,
      mentionedOtherParticipantIds,
      mentionedParticipantIds,
      recentlyInvolved,
    }
  }
  if (twoMemberDirectChannel) {
    return {
      decision: 'must_answer',
      reason: 'message_posted is in a two-member channel, so the unmentioned message is directed at this agent',
      triggerMessageId: triggerMessage?.id ?? null,
      directlyMentionedSelf,
      mentionedOtherParticipantIds,
      mentionedParticipantIds,
      recentlyInvolved,
    }
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

export class KnotworkMcpTransport implements KnotworkTransport {
  private clientPromise: Promise<KnotworkMcpClient> | null = null

  constructor(private readonly params: McpTransportParams) {}

  private async client(): Promise<KnotworkMcpClient> {
    if (!this.clientPromise) {
      this.clientPromise = createKnotworkMcpClient({
        backendUrl: this.params.baseUrl,
        workspaceId: this.params.workspaceId,
        bearerToken: this.params.jwt,
        transport: { type: 'http', mcpServerUrl: mcpServerUrl(this.params.baseUrl) },
        clientInfo: { name: 'openclaw-knotwork-bridge', version: '1.0.0' },
      }).then(async (client) => {
        await client.connect()
        return client
      })
    }
    return this.clientPromise
  }

  async getCapabilitySnapshot(trigger: TaskTrigger): Promise<SemanticCapabilitySnapshot> {
    const channelId = typeof trigger.channel_id === 'string' && trigger.channel_id.trim() ? trigger.channel_id.trim() : null
    const client = await this.client()
    const subscriptions = await mcpList<ChannelSubscription>(client.listMyChannelSubscriptions()).catch(() => [])
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
    const client = await this.client()
    const channelId = typeof trigger.channel_id === 'string' && trigger.channel_id.trim() ? trigger.channel_id.trim() : null
    const effectiveRunIdWithoutChannel = typeof trigger.run_id === 'string' && trigger.run_id.trim() ? trigger.run_id.trim() : null
    if (!channelId) {
      const [run, runNodes, escalation] = await Promise.all([
        effectiveRunIdWithoutChannel
          ? mcpResult<RunInfo>(client.getRun(effectiveRunIdWithoutChannel)).catch(() => null)
          : Promise.resolve(null),
        effectiveRunIdWithoutChannel
          ? mcpList<RunNodeStateInfo>(client.listRunNodes(effectiveRunIdWithoutChannel)).catch(() => [])
          : Promise.resolve([]),
        typeof trigger.escalation_id === 'string' && trigger.escalation_id.trim()
          ? mcpResult<EscalationInfo>(client.getEscalation(trigger.escalation_id.trim())).catch(() => null)
          : Promise.resolve(null),
      ])
      return {
        trigger,
        agentSelf: await mcpResult<WorkspaceMemberInfo>(client.getCurrentMember()).catch(() => null),
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
      mcpResult<WorkspaceMemberInfo>(client.getCurrentMember()).catch(() => null),
      mcpResult<ChannelInfo>(client.getChannel(channelId)),
      mcpList<ChannelMessage>(client.listChannelMessages(channelId)),
      mcpList<ParticipantInfo>(client.listChannelParticipants(channelId)).catch(() => []),
      mcpList<ChannelAssetBinding>(client.listChannelAssets(channelId)).catch(() => []),
    ])

    const fileBindings = channelAssets.filter((binding) => binding.asset_type === 'file' && binding.path)
    const folderBindings = channelAssets.filter((binding) => binding.asset_type === 'folder' && binding.path)
    const projectId = typeof channel.project_id === 'string' && channel.project_id.trim()
      ? channel.project_id.trim()
      : null
    const knowledgeFiles = await Promise.all(
      fileBindings
        .slice(0, 3)
        .map((binding) => mcpResult<KnowledgeFileWithContent>(client.readKnowledgeFile(String(binding.path), projectId)).catch(() => null)),
    )
    const allKnowledgeFiles = folderBindings.length > 0
      ? await mcpList<KnowledgeFileSummary>(client.listKnowledgeFiles(projectId)).catch(() => [])
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
      objectiveId ? mcpList<ObjectiveInfo>(client.getObjectiveChain(objectiveId)).catch(() => []) : Promise.resolve([]),
      projectId ? mcpResult<ProjectDashboardInfo>(client.getProjectDashboard(projectId)).catch(() => null) : Promise.resolve(null),
      graphId ? mcpResult<GraphInfo>(client.getGraph(graphId)).catch(() => null) : Promise.resolve(null),
      graphId ? mcpResult<GraphDraftInfo>(client.getGraphRootDraft(graphId)).catch(() => null) : Promise.resolve(null),
      effectiveRunId ? mcpResult<RunInfo>(client.getRun(effectiveRunId)).catch(() => null) : Promise.resolve(null),
      effectiveRunId ? mcpList<RunNodeStateInfo>(client.listRunNodes(effectiveRunId)).catch(() => []) : Promise.resolve([]),
      typeof trigger.escalation_id === 'string' && trigger.escalation_id.trim()
        ? mcpResult<EscalationInfo>(client.getEscalation(trigger.escalation_id.trim())).catch(() => null)
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
    const client = await this.client()
    const msg = await mcpResult<{ id?: string }>(client.postChannelMessage({
      channelRef: input.channelId,
      content: input.content,
      role: 'assistant',
      authorType: 'agent',
      authorName: input.authorName || this.params.authorName,
      runId: input.runId ?? undefined,
    }))
    return { messageId: String(msg.id ?? '') }
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
    const client = await this.client()
    await client.resolveEscalation({
      escalationId: input.escalationId,
      resolution: input.resolution,
      actorName: input.actorName,
      guidance: input.guidance,
      overrideOutput: input.overrideOutput as JsonObject | undefined,
      nextBranch: input.nextBranch ?? undefined,
      answers: input.answers ?? undefined,
      channelId: input.channelId ?? undefined,
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
  }): Promise<{ proposalId: string; channelId?: string | null }> {
    const client = await this.client()
    const result = await mcpResult<{ id?: string; channel_id?: string | null }>(client.createKnowledgeChange({
      path: input.path,
      proposedContent: input.proposedContent,
      reason: input.reason,
      runId: input.runId,
      nodeId: input.nodeId,
      agentRef: input.agentRef ?? null,
      sourceChannelId: input.sourceChannelId ?? null,
    }))
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
    const client = await this.client()
    const draft = await mcpResult<{ id?: string }>(client.updateGraphRootDraft({
      graphId: input.graphId,
      definition: input.definition as JsonObject,
      note: input.note ?? null,
    }))
    return { graphId: input.graphId, draftId: String(draft.id ?? '') || null }
  }

  async archiveDelivery(deliveryId: string): Promise<void> {
    const client = await this.client()
    await client.updateInboxDelivery({ deliveryId, read: true, archived: true })
  }
}

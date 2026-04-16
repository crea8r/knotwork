import { createKnotworkMcpClient, type JsonObject, type KnotworkMcpClient } from '@knotwork/mcp-client'
import type { KnotworkTransport, SemanticCapabilitySnapshot } from './contracts'
import { persistCachedContract, readCachedContract } from './contract-cache'
import type {
  ChannelMessage,
  ChannelSubscription,
  MCPContractManifest,
  MessageResponsePolicy,
  ParticipantInfo,
  PluginConfig,
  TaskTrigger,
  WorkPacket,
  WorkspaceMemberInfo,
} from '../types'

type McpTransportParams = {
  baseUrl: string
  workspaceId: string
  jwt: string
  authorName: string
  pluginConfig?: PluginConfig
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
  private readonly contractCache = new Map<string, MCPContractManifest>()

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

  async getCapabilitySnapshot(input: { trigger: TaskTrigger; allowedActions: string[] }): Promise<SemanticCapabilitySnapshot> {
    const channelId = typeof input.trigger.channel_id === 'string' && input.trigger.channel_id.trim() ? input.trigger.channel_id.trim() : null
    const client = await this.client()
    const subscriptions = await mcpList<ChannelSubscription>(
      client.callTool('list_my_channel_subscriptions', undefined as unknown as JsonObject),
    ).catch(() => [])
    const activeChannelIds = subscriptions.filter((item) => item.subscribed).map((item) => item.channel_id)
    if (channelId && !activeChannelIds.includes(channelId)) activeChannelIds.push(channelId)
    return {
      workspaceId: this.params.workspaceId,
      agentId: null,
      actions: Object.fromEntries(input.allowedActions.map((name) => [name, true])),
      channels: {
        readAllowed: activeChannelIds,
        postAllowed: activeChannelIds,
        signalAllowed: [],
      },
    }
  }

  async getWorkPacket(input: {
    taskId: string
    trigger: TaskTrigger
    sessionName?: string
    legacyUserPrompt?: string
  }): Promise<WorkPacket> {
    const client = await this.client()
    return await mcpResult<WorkPacket>(client.callTool('build_mcp_work_packet', {
      task_id: input.taskId,
      trigger: input.trigger as unknown as JsonObject,
      session_name: input.sessionName ?? null,
      legacy_user_prompt: input.legacyUserPrompt ?? null,
    }))
  }

  async getMcpContract(contractId: string, checksumHint?: string | null): Promise<MCPContractManifest> {
    const hint = String(checksumHint ?? '').trim()
    if (hint) {
      const key = this.contractCacheKey(contractId, hint)
      const cached = this.contractCache.get(key)
      if (cached && cached.checksum === hint) return cached
      const diskCached = await readCachedContract(this.params.pluginConfig, contractId, hint)
      if (diskCached) {
        this.contractCache.set(key, diskCached)
        return diskCached
      }
    }
    const client = await this.client()
    const contract = await mcpResult<MCPContractManifest>(
      client.callTool('get_mcp_contract', { contract_id: contractId } as JsonObject),
    )
    this.contractCache.set(this.contractCacheKey(contract.id, contract.checksum), contract)
    await persistCachedContract(this.params.pluginConfig, contract).catch(() => {})
    return contract
  }

  async executeMcpAction(input: {
    contractId: string
    contractChecksum: string
    action: Record<string, unknown>
    fallbackRunId?: string | null
    fallbackSourceChannelId?: string | null
    fallbackTriggerMessageId?: string | null
  }): Promise<{
    action_id: string
    status: string
    reason?: string
    effect_ref?: { kind: string; id: string } | null
    context_section?: string | null
    output?: unknown
  }> {
    const client = await this.client()
    return await mcpResult<{
      action_id: string
      status: string
      reason?: string
      effect_ref?: { kind: string; id: string } | null
      context_section?: string | null
      output?: unknown
    }>(
      client.callTool('execute_mcp_action', {
        contract_id: input.contractId,
        contract_checksum: input.contractChecksum,
        action: input.action as JsonObject,
        fallback_run_id: input.fallbackRunId ?? null,
        fallback_source_channel_id: input.fallbackSourceChannelId ?? null,
        fallback_trigger_message_id: input.fallbackTriggerMessageId ?? null,
      } as JsonObject),
    )
  }

  private contractCacheKey(contractId: string, checksum: string): string {
    return `${contractId}:${checksum}`
  }

  async archiveDelivery(deliveryId: string): Promise<void> {
    const client = await this.client()
    await client.updateInboxDelivery({ deliveryId, read: true, archived: true })
  }
}

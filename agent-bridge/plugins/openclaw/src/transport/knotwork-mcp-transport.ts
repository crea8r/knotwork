import { createKnotworkMcpClient, type JsonObject, type KnotworkMcpClient } from '@knotwork/mcp-client'
import type { KnotworkTransport, SemanticCapabilitySnapshot, SemanticThinkingContext } from './contracts'
import type {
  ChannelAssetBinding,
  ChannelInfo,
  ChannelMessage,
  ChannelSubscription,
  EscalationInfo,
  KnowledgeFileSummary,
  KnowledgeFileWithContent,
  RunInfo,
  RunNodeStateInfo,
  TaskTrigger,
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
    const subscriptions = await mcpResult<ChannelSubscription[]>(client.listMyChannelSubscriptions()).catch(() => [])
    const activeChannelIds = subscriptions.filter((item) => item.subscribed).map((item) => item.channel_id)
    if (channelId && !activeChannelIds.includes(channelId)) activeChannelIds.push(channelId)
    return {
      workspaceId: this.params.workspaceId,
      agentId: null,
      actions: {
        'channel.post_message': true,
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
          ? mcpResult<RunNodeStateInfo[]>(client.listRunNodes(effectiveRunIdWithoutChannel)).catch(() => [])
          : Promise.resolve([]),
        typeof trigger.escalation_id === 'string' && trigger.escalation_id.trim()
          ? mcpResult<EscalationInfo>(client.getEscalation(trigger.escalation_id.trim())).catch(() => null)
          : Promise.resolve(null),
      ])
      return {
        trigger,
        channel: null,
        messages: [],
        channelAssets: [],
        assetContext: {
          knowledgeFiles: [],
          folderFiles: [],
          run,
          runNodes,
          escalation,
        },
        legacyUserPrompt: legacyUserPrompt ?? null,
      }
    }

    const [channel, messages, channelAssets] = await Promise.all([
      mcpResult<ChannelInfo>(client.getChannel(channelId)),
      mcpResult<ChannelMessage[]>(client.listChannelMessages(channelId)),
      mcpResult<ChannelAssetBinding[]>(client.listChannelAssets(channelId)).catch(() => []),
    ])

    const fileBindings = channelAssets.filter((binding) => binding.asset_type === 'file' && binding.path)
    const folderBindings = channelAssets.filter((binding) => binding.asset_type === 'folder' && binding.path)
    const knowledgeFiles = await Promise.all(
      fileBindings
        .slice(0, 3)
        .map((binding) => mcpResult<KnowledgeFileWithContent>(client.readKnowledgeFile(String(binding.path))).catch(() => null)),
    )
    const allKnowledgeFiles = folderBindings.length > 0
      ? await mcpResult<KnowledgeFileSummary[]>(client.listKnowledgeFiles()).catch(() => [])
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

    const [run, runNodes, escalation] = await Promise.all([
      effectiveRunId ? mcpResult<RunInfo>(client.getRun(effectiveRunId)).catch(() => null) : Promise.resolve(null),
      effectiveRunId ? mcpResult<RunNodeStateInfo[]>(client.listRunNodes(effectiveRunId)).catch(() => []) : Promise.resolve([]),
      typeof trigger.escalation_id === 'string' && trigger.escalation_id.trim()
        ? mcpResult<EscalationInfo>(client.getEscalation(trigger.escalation_id.trim())).catch(() => null)
        : Promise.resolve(null),
    ])

    return {
      trigger,
      channel,
      messages,
      channelAssets,
      assetContext: {
        knowledgeFiles: knowledgeFiles.filter(Boolean) as SemanticThinkingContext['assetContext']['knowledgeFiles'],
        folderFiles,
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

  async archiveDelivery(deliveryId: string): Promise<void> {
    const client = await this.client()
    await client.updateInboxDelivery({ deliveryId, read: true, archived: true })
  }
}

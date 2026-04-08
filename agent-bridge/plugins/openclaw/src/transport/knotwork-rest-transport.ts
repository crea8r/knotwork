import {
  archiveInboxDelivery,
  createKnowledgeChange,
  fetchChannel,
  fetchChannelAssets,
  fetchChannelMessages,
  fetchEscalation,
  fetchKnowledgeFile,
  fetchMyChannelSubscriptions,
  fetchRun,
  fetchRunNodes,
  listKnowledgeFiles,
  postChannelMessage,
  resolveEscalation,
} from '../openclaw/bridge'
import type { KnotworkTransport, SemanticCapabilitySnapshot, SemanticThinkingContext } from './contracts'
import type { TaskTrigger } from '../types'

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
      fetchChannel(this.params.baseUrl, this.params.workspaceId, this.params.jwt, channelId),
      fetchChannelMessages(this.params.baseUrl, this.params.workspaceId, this.params.jwt, channelId),
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

    const [run, runNodes, escalation] = await Promise.all([
      effectiveRunId ? fetchRun(this.params.baseUrl, this.params.workspaceId, this.params.jwt, effectiveRunId).catch(() => null) : Promise.resolve(null),
      effectiveRunId ? fetchRunNodes(this.params.baseUrl, this.params.workspaceId, this.params.jwt, effectiveRunId).catch(() => []) : Promise.resolve([]),
      typeof trigger.escalation_id === 'string' && trigger.escalation_id.trim()
        ? fetchEscalation(this.params.baseUrl, this.params.workspaceId, this.params.jwt, trigger.escalation_id.trim()).catch(() => null)
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

  async archiveDelivery(deliveryId: string): Promise<void> {
    await archiveInboxDelivery(this.params.baseUrl, this.params.workspaceId, this.params.jwt, deliveryId)
  }
}

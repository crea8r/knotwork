import {
  archiveInboxDelivery,
  executeMcpAction,
  fetchMcpContract,
  fetchMyChannelSubscriptions,
  fetchWorkPacket,
} from '../openclaw/bridge'
import { persistCachedContract, readCachedContract } from './contract-cache'
import type { KnotworkTransport, SemanticCapabilitySnapshot } from './contracts'
import type {
  MCPContractManifest,
  PluginConfig,
  TaskTrigger,
  WorkPacket,
} from '../types'

export class KnotworkRestTransport implements KnotworkTransport {
  private readonly contractCache = new Map<string, MCPContractManifest>()

  constructor(
    private readonly params: {
      baseUrl: string
      workspaceId: string
      jwt: string
      authorName: string
      pluginConfig?: PluginConfig
    },
  ) {}

  async getCapabilitySnapshot(input: { trigger: TaskTrigger; allowedActions: string[] }): Promise<SemanticCapabilitySnapshot> {
    const channelId = typeof input.trigger.channel_id === 'string' && input.trigger.channel_id.trim() ? input.trigger.channel_id.trim() : null
    const subscriptions = await fetchMyChannelSubscriptions(this.params.baseUrl, this.params.workspaceId, this.params.jwt).catch(() => [])
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
    return await fetchWorkPacket(this.params.baseUrl, this.params.workspaceId, this.params.jwt, {
      taskId: input.taskId,
      trigger: input.trigger,
      sessionName: input.sessionName,
      legacyUserPrompt: input.legacyUserPrompt,
    })
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
    const contract = await fetchMcpContract(this.params.baseUrl, this.params.workspaceId, this.params.jwt, contractId)
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
  }): Promise<{ action_id: string; status: string; reason?: string; effect_ref?: { kind: string; id: string } | null }> {
    return await executeMcpAction(this.params.baseUrl, this.params.workspaceId, this.params.jwt, {
      contract_id: input.contractId,
      contract_checksum: input.contractChecksum,
      action: input.action,
      fallback_run_id: input.fallbackRunId ?? null,
      fallback_source_channel_id: input.fallbackSourceChannelId ?? null,
      fallback_trigger_message_id: input.fallbackTriggerMessageId ?? null,
    }) as {
      action_id: string
      status: string
      reason?: string
      effect_ref?: { kind: string; id: string } | null
      context_section?: string | null
      output?: unknown
    }
  }

  async archiveDelivery(deliveryId: string): Promise<void> {
    await archiveInboxDelivery(this.params.baseUrl, this.params.workspaceId, this.params.jwt, deliveryId)
  }

  private contractCacheKey(contractId: string, checksum: string): string {
    return `${contractId}:${checksum}`
  }

}

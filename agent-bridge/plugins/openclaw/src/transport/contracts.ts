import type {
  MCPContractManifest,
  TaskTrigger,
  WorkPacket,
} from '../types'

export type MCPContract = MCPContractManifest

export type SemanticCapabilitySnapshot = {
  workspaceId: string
  agentId: string | null
  actions: Record<string, boolean>
  channels: {
    readAllowed: string[]
    postAllowed: string[]
    signalAllowed: string[]
  }
}

export type SemanticThinkInput = {
  taskId: string
  channelId?: string
  sessionName?: string
  systemPrompt?: string
  userPrompt: string
}

export interface ThinkingRuntime {
  think(input: SemanticThinkInput): Promise<{ rawOutput: string }>
}

export interface KnotworkTransport {
  getCapabilitySnapshot(input: { trigger: TaskTrigger; allowedActions: string[] }): Promise<SemanticCapabilitySnapshot>
  getWorkPacket(input: {
    taskId: string
    trigger: TaskTrigger
    sessionName?: string
    legacyUserPrompt?: string
  }): Promise<WorkPacket>
  getMcpContract(contractId: string, checksumHint?: string | null): Promise<MCPContract>
  executeMcpAction(input: {
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
  }>
  archiveDelivery(deliveryId: string): Promise<void>
}

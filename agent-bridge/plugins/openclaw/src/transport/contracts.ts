import type {
  ChannelAssetBinding,
  ChannelInfo,
  ChannelMessage,
  EscalationInfo,
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

export type SemanticThinkingContext = {
  trigger: TaskTrigger
  agentSelf: WorkspaceMemberInfo | null
  channel: ChannelInfo | null
  messages: ChannelMessage[]
  channelParticipants: ParticipantInfo[]
  channelAssets: ChannelAssetBinding[]
  messageResponsePolicy: MessageResponsePolicy | null
  assetContext: {
    knowledgeFiles: KnowledgeFileWithContent[]
    folderFiles: Array<{ binding: ChannelAssetBinding; files: KnowledgeFileSummary[] }>
    objectiveChain: ObjectiveInfo[]
    projectDashboard: ProjectDashboardInfo | null
    run: RunInfo | null
    runNodes: RunNodeStateInfo[]
    escalation: EscalationInfo | null
  }
  legacyUserPrompt: string | null
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
  getCapabilitySnapshot(trigger: TaskTrigger): Promise<SemanticCapabilitySnapshot>
  loadThinkingContext(trigger: TaskTrigger, legacyUserPrompt?: string): Promise<SemanticThinkingContext>
  postChannelMessage(input: {
    channelId: string
    content: string
    authorName: string
    runId?: string | null
  }): Promise<{ messageId: string }>
  resolveEscalation(input: {
    escalationId: string
    resolution: string
    actorName: string
    guidance?: string
    overrideOutput?: Record<string, unknown> | null
    nextBranch?: string | null
    answers?: string[] | null
    channelId?: string | null
  }): Promise<{ escalationId: string }>
  proposeKnowledgeChange(input: {
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
  }): Promise<{ proposalId: string; channelId?: string | null }>
  archiveDelivery(deliveryId: string): Promise<void>
}

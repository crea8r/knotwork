import { authenticateKnotworkAgent, createPemFileSigner } from './auth.js'
import { McpClient } from './client.js'
import { discoverKnotworkWorkspace, fetchWorkspaceSkills } from './discovery.js'
import { KnotworkAuthError, McpProtocolError } from './errors.js'
import { StdioMcpTransport, StreamableHttpMcpTransport } from './transports.js'
import type {
  CreateKnotworkMcpClientOptions,
  JsonObject,
  KnotworkAgentDiscovery,
  KnotworkAuthSession,
  KnotworkObjective,
  KnotworkStdioOptions,
  KnotworkTransportOptions,
  McpInitializeResult,
} from './types.js'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function joinResourceText(contents: Array<{ text?: string; blob?: string }>): string {
  return contents
    .map((item) => item.text ?? item.blob ?? '')
    .filter((item) => item.length > 0)
    .join('\n')
}

export class KnotworkMcpClient {
  readonly backendUrl: string
  readonly workspaceId: string
  readonly discovery: KnotworkAgentDiscovery
  readonly auth: KnotworkAuthSession

  private readonly client: McpClient

  constructor(options: {
    backendUrl: string
    workspaceId: string
    discovery: KnotworkAgentDiscovery
    auth: KnotworkAuthSession
    client: McpClient
  }) {
    this.backendUrl = options.backendUrl
    this.workspaceId = options.workspaceId
    this.discovery = options.discovery
    this.auth = options.auth
    this.client = options.client
  }

  async connect(): Promise<McpInitializeResult> {
    return this.client.connect()
  }

  async close(): Promise<void> {
    await this.client.close()
  }

  async listTools() {
    return this.client.listTools()
  }

  async listResources() {
    return this.client.listResources()
  }

  async readResource(uri: string) {
    return this.client.readResource(uri)
  }

  async callTool<T = unknown>(name: string, args?: JsonObject): Promise<T> {
    return this.client.callTool<T>(name, args)
  }

  async getWorkspaceSkills(): Promise<string> {
    try {
      const contents = await this.client.readResource('knotwork://workspace/skills')
      if (contents.length > 0) {
        return joinResourceText(contents)
      }
    } catch (error) {
      if (!(error instanceof McpProtocolError)) {
        throw error
      }
    }
    return fetchWorkspaceSkills(this.discovery.skills_endpoint, this.auth.accessToken)
  }

  async getWorkspaceOverview<T = unknown>(): Promise<T> {
    return this.client.callTool<T>('get_workspace_overview')
  }

  async listParticipants<T = unknown>(): Promise<T> {
    return this.client.callTool<T>('list_participants')
  }

  async getCurrentMember<T = unknown>(): Promise<T> {
    return this.client.callTool<T>('get_current_member')
  }

  async listMembers<T = unknown>(input?: { kind?: string | null; disabled?: boolean | null }): Promise<T> {
    return this.client.callTool<T>('list_members', {
      ...(input?.kind ? { kind: input.kind } : {}),
      ...(input?.disabled !== undefined && input.disabled !== null ? { disabled: input.disabled } : {}),
    })
  }

  async getProjectDashboard<T = unknown>(projectRef: string): Promise<T> {
    return this.client.callTool<T>('get_project_dashboard', { project_ref: projectRef })
  }

  async listGraphs<T = unknown>(projectId?: string | null): Promise<T> {
    return this.client.callTool<T>('list_graphs', {
      ...(projectId ? { project_id: projectId } : {}),
    })
  }

  async createGraph<T = unknown>(input: {
    name: string
    description?: string | null
    path?: string | null
    defaultModel?: string | null
    projectId?: string | null
    definition?: JsonObject | null
  }): Promise<T> {
    return this.client.callTool<T>('create_graph', {
      name: input.name,
      description: input.description ?? null,
      path: input.path ?? '',
      default_model: input.defaultModel ?? null,
      project_id: input.projectId ?? null,
      definition: input.definition ?? {},
    })
  }

  async getGraph<T = unknown>(graphId: string): Promise<T> {
    return this.client.callTool<T>('get_graph', { graph_id: graphId })
  }

  async getGraphRootDraft<T = unknown>(graphId: string): Promise<T> {
    return this.client.callTool<T>('get_graph_root_draft', { graph_id: graphId })
  }

  async updateGraphRootDraft<T = unknown>(input: {
    graphId: string
    definition: JsonObject
    note?: string | null
  }): Promise<T> {
    return this.client.callTool<T>('update_graph_root_draft', {
      graph_id: input.graphId,
      definition: input.definition,
      note: input.note ?? null,
    })
  }

  async listOpenEscalations<T = unknown>(): Promise<T> {
    return this.client.callTool<T>('list_escalations', { status: 'open' })
  }

  async getInbox<T = unknown>(archived = false): Promise<T> {
    return this.client.callTool<T>('get_inbox', { archived })
  }

  async updateInboxDelivery<T = unknown>(input: {
    deliveryId: string
    read?: boolean | null
    archived?: boolean | null
  }): Promise<T> {
    return this.client.callTool<T>('update_inbox_delivery', {
      delivery_id: input.deliveryId,
      read: input.read ?? null,
      archived: input.archived ?? null,
    })
  }

  async listChannels<T = unknown>(): Promise<T> {
    return this.client.callTool<T>('list_channels')
  }

  async getChannel<T = unknown>(channelRef: string): Promise<T> {
    return this.client.callTool<T>('get_channel', { channel_ref: channelRef })
  }

  async getObjective<T = KnotworkObjective>(objectiveRef: string): Promise<T> {
    return this.client.callTool<T>('get_objective', { objective_ref: objectiveRef })
  }

  async getObjectiveChain<T = KnotworkObjective[]>(objectiveRef: string): Promise<T> {
    try {
      return await this.client.callTool<T>('get_objective_chain', { objective_ref: objectiveRef })
    } catch (error) {
      if (!(error instanceof McpProtocolError)) {
        throw error
      }
      const chain: KnotworkObjective[] = []
      const seen = new Set<string>()
      let currentRef: string | null = objectiveRef
      while (currentRef) {
        if (seen.has(currentRef)) {
          throw new McpProtocolError(`Objective ancestry cycle detected at ${currentRef}`)
        }
        seen.add(currentRef)
        const objective: KnotworkObjective = await this.getObjective<KnotworkObjective>(currentRef)
        chain.push(objective)
        currentRef = objective.parent_objective_id ?? null
      }
      return chain.reverse() as T
    }
  }

  async listChannelMessages<T = unknown>(channelRef: string): Promise<T> {
    return this.client.callTool<T>('list_channel_messages', { channel_ref: channelRef })
  }

  async listChannelParticipants<T = unknown>(channelRef: string): Promise<T> {
    return this.client.callTool<T>('list_channel_participants', { channel_ref: channelRef })
  }

  async listChannelAssets<T = unknown>(channelRef: string): Promise<T> {
    return this.client.callTool<T>('list_channel_assets', { channel_ref: channelRef })
  }

  async listMyChannelSubscriptions<T = unknown>(): Promise<T> {
    return this.client.callTool<T>('list_my_channel_subscriptions')
  }

  async getRun<T = unknown>(runId: string): Promise<T> {
    return this.client.callTool<T>('get_run', { run_id: runId })
  }

  async listRunNodes<T = unknown>(runId: string): Promise<T> {
    return this.client.callTool<T>('list_run_nodes', { run_id: runId })
  }

  async listKnowledgeFiles<T = unknown>(projectId?: string | null): Promise<T> {
    return this.client.callTool<T>('list_knowledge_files', {
      ...(projectId ? { project_id: projectId } : {}),
    })
  }

  async readKnowledgeFile<T = unknown>(path: string, projectId?: string | null): Promise<T> {
    return this.client.callTool<T>('read_knowledge_file', {
      path,
      ...(projectId ? { project_id: projectId } : {}),
    })
  }

  async createKnowledgeChange<T = unknown>(input: {
    path: string
    proposedContent: string
    reason: string
    runId?: string | null
    nodeId?: string | null
    agentRef?: string | null
    sourceChannelId?: string | null
  }): Promise<T> {
    return this.client.callTool<T>('create_knowledge_change', {
      path: input.path,
      proposed_content: input.proposedContent,
      reason: input.reason,
      run_id: input.runId ?? null,
      node_id: input.nodeId ?? null,
      agent_ref: input.agentRef ?? null,
      source_channel_id: input.sourceChannelId ?? null,
    })
  }

  async getEscalation<T = unknown>(escalationId: string): Promise<T> {
    return this.client.callTool<T>('get_escalation', { escalation_id: escalationId })
  }

  async resolveEscalation<T = unknown>(input: {
    escalationId: string
    resolution: string
    actorName: string
    guidance?: string
    overrideOutput?: JsonObject
    nextBranch?: string
    answers?: string[]
    channelId?: string
  }): Promise<T> {
    return this.client.callTool<T>('resolve_escalation', {
      escalation_id: input.escalationId,
      resolution: input.resolution,
      actor_name: input.actorName,
      ...(input.guidance ? { guidance: input.guidance } : {}),
      ...(input.overrideOutput ? { override_output: input.overrideOutput } : {}),
      ...(input.nextBranch ? { next_branch: input.nextBranch } : {}),
      ...(input.answers ? { answers: input.answers as unknown as JsonObject[string] } : {}),
      ...(input.channelId ? { channel_id: input.channelId } : {}),
    })
  }

  async postChannelMessage<T = unknown>(input: {
    channelRef: string
    content: string
    role?: string
    authorType?: string
    authorName?: string
    runId?: string
    nodeId?: string
    metadata?: JsonObject
  }): Promise<T> {
    return this.client.callTool<T>('post_channel_message', {
      channel_ref: input.channelRef,
      content: input.content,
      role: input.role ?? 'user',
      author_type: input.authorType ?? 'agent',
      ...(input.authorName ? { author_name: input.authorName } : {}),
      ...(input.runId ? { run_id: input.runId } : {}),
      ...(input.nodeId ? { node_id: input.nodeId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    })
  }
}

async function authenticate(
  backendUrl: string,
  options: CreateKnotworkMcpClientOptions,
): Promise<KnotworkAuthSession> {
  if (options.bearerToken) {
    return {
      accessToken: options.bearerToken,
      expiresAt: null,
      publicKey: '',
    }
  }

  const signer =
    options.signer ?? (options.privateKeyPath ? createPemFileSigner(options.privateKeyPath) : null)
  if (!signer) {
    throw new KnotworkAuthError(
      'Missing authentication input: provide bearerToken, signer, or privateKeyPath',
    )
  }
  return authenticateKnotworkAgent(backendUrl, signer)
}

function buildTransport(
  transportOptions: KnotworkTransportOptions | undefined,
  backendUrl: string,
  workspaceId: string,
  auth: KnotworkAuthSession,
  discovery: KnotworkAgentDiscovery,
) {
  if (transportOptions?.type === 'stdio') {
    const stdio = transportOptions as KnotworkStdioOptions
    return new StdioMcpTransport({
      command: stdio.command,
      args: stdio.args,
      cwd: stdio.cwd,
      env: {
        ...(stdio.env ?? {}),
        KNOTWORK_API_URL: normalizeBaseUrl(backendUrl),
        KNOTWORK_BEARER_TOKEN: auth.accessToken,
        KNOTWORK_WORKSPACE_ID: workspaceId,
      },
    })
  }

  return new StreamableHttpMcpTransport({
    url: transportOptions?.mcpServerUrl ?? discovery.mcp_server_url,
    bearerToken: auth.accessToken,
    headers: {
      'X-Knotwork-Workspace-Id': workspaceId,
    },
  })
}

export async function createKnotworkMcpClient(
  options: CreateKnotworkMcpClientOptions,
): Promise<KnotworkMcpClient> {
  const backendUrl = normalizeBaseUrl(options.backendUrl)
  const discovery = await discoverKnotworkWorkspace(backendUrl, options.workspaceId)
  const auth = await authenticate(backendUrl, options)
  const transport = buildTransport(
    options.transport,
    backendUrl,
    options.workspaceId,
    auth,
    discovery,
  )
  const client = new McpClient({
    transport,
    clientInfo: options.clientInfo,
  })
  return new KnotworkMcpClient({
    backendUrl,
    workspaceId: options.workspaceId,
    discovery,
    auth,
    client,
  })
}

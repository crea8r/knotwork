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
  McpResourceContents,
  McpTool,
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

  async readResourceText(uri: string): Promise<string> {
    const contents = await this.client.readResource(uri)
    return joinResourceText(contents as McpResourceContents[])
  }

  async callTool<T = unknown>(name: string, args?: JsonObject): Promise<T> {
    return this.client.callTool<T>(name, args)
  }

  async getTool(name: string): Promise<McpTool | null> {
    const tools = await this.listTools()
    return tools.find((tool) => tool.name === name) ?? null
  }

  async hasTool(name: string): Promise<boolean> {
    return (await this.getTool(name)) !== null
  }

  async readWorkspaceSkills(): Promise<string> {
    try {
      const text = await this.readResourceText('knotwork://workspace/skills')
      if (text.length > 0) return text
    } catch (error) {
      if (!(error instanceof McpProtocolError)) {
        throw error
      }
    }
    return fetchWorkspaceSkills(this.discovery.skills_endpoint, this.auth.accessToken)
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

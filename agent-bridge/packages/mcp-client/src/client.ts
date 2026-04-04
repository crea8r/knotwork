import { McpProtocolError } from './errors.js'
import type {
  JsonObject,
  JsonRpcRequest,
  McpImplementation,
  McpInitializeResult,
  McpResource,
  McpResourceContents,
  McpResourceTemplate,
  McpTool,
  McpTransport,
} from './types.js'

const DEFAULT_PROTOCOL_VERSION = '2025-11-25'

function asResult<T>(value: unknown): T {
  return value as T
}

function unwrapToolCallResult<T>(value: unknown): T {
  if (!value || typeof value !== 'object') {
    return value as T
  }
  const candidate = value as {
    structuredContent?: unknown
    content?: unknown
    isError?: boolean
  }
  if (candidate.structuredContent !== undefined) {
    return candidate.structuredContent as T
  }
  return value as T
}

export class McpClient {
  private readonly transport: McpTransport
  private readonly clientInfo: McpImplementation
  private readonly clientCapabilities: Record<string, unknown>
  private nextId: number
  private initialized: boolean
  private initializeResult: McpInitializeResult | null

  constructor(options: {
    transport: McpTransport
    clientInfo?: McpImplementation
    capabilities?: Record<string, unknown>
  }) {
    this.transport = options.transport
    this.clientInfo = options.clientInfo ?? {
      name: '@knotwork/mcp-client',
      version: '0.1.0',
    }
    this.clientCapabilities = options.capabilities ?? {}
    this.nextId = 1
    this.initialized = false
    this.initializeResult = null
  }

  async connect(): Promise<McpInitializeResult> {
    if (this.initialized && this.initializeResult) {
      return this.initializeResult
    }

    await this.transport.connect()
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: this.clientCapabilities as JsonObject,
        clientInfo: this.clientInfo as unknown as JsonObject,
      },
    }
    const response = await this.transport.request(message)
    if (!('result' in response)) {
      throw new McpProtocolError('MCP initialize returned no result')
    }
    const result = asResult<McpInitializeResult>(response.result)

    this.transport.setProtocolVersion?.(result.protocolVersion)
    await this.transport.notify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })

    this.initialized = true
    this.initializeResult = result
    return result
  }

  async close(): Promise<void> {
    await this.transport.close()
    this.initialized = false
    this.initializeResult = null
  }

  private async ensureConnected(): Promise<void> {
    if (!this.initialized) {
      await this.connect()
    }
  }

  async request<T>(method: string, params?: JsonObject): Promise<T> {
    await this.ensureConnected()

    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      ...(params ? { params } : {}),
    }
    const response = await this.transport.request(message)
    if (!('result' in response)) {
      throw new McpProtocolError(`MCP request ${method} returned no result`)
    }
    return asResult<T>(response.result)
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = []
    let cursor: string | undefined
    do {
      const result = await this.request<{ tools?: McpTool[]; nextCursor?: string }>(
        'tools/list',
        cursor ? { cursor } : undefined,
      )
      tools.push(...(result.tools ?? []))
      cursor = result.nextCursor
    } while (cursor)
    return tools
  }

  async listResources(): Promise<McpResource[]> {
    const resources: McpResource[] = []
    let cursor: string | undefined
    do {
      const result = await this.request<{ resources?: McpResource[]; nextCursor?: string }>(
        'resources/list',
        cursor ? { cursor } : undefined,
      )
      resources.push(...(result.resources ?? []))
      cursor = result.nextCursor
    } while (cursor)
    return resources
  }

  async listResourceTemplates(): Promise<McpResourceTemplate[]> {
    const templates: McpResourceTemplate[] = []
    let cursor: string | undefined
    do {
      const result = await this.request<{
        resourceTemplates?: McpResourceTemplate[]
        nextCursor?: string
      }>('resources/templates/list', cursor ? { cursor } : undefined)
      templates.push(...(result.resourceTemplates ?? []))
      cursor = result.nextCursor
    } while (cursor)
    return templates
  }

  async readResource(uri: string): Promise<McpResourceContents[]> {
    const result = await this.request<{ contents?: McpResourceContents[] }>('resources/read', {
      uri,
    })
    return result.contents ?? []
  }

  async callTool<T = unknown>(name: string, args?: JsonObject): Promise<T> {
    const result = await this.request<unknown>('tools/call', {
      name,
      arguments: (args ?? {}) as JsonObject,
    })
    return unwrapToolCallResult<T>(result)
  }
}

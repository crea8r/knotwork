export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonArray
export interface JsonObject {
  [key: string]: JsonValue
}
export interface JsonArray extends Array<JsonValue> {}

export type JsonRpcId = number | string

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: JsonObject
}

export type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: JsonObject
}

export type JsonRpcSuccess = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: JsonValue | Record<string, unknown> | unknown[] | null
}

export type JsonRpcFailure = {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export type McpImplementation = {
  name: string
  version: string
}

export type McpTool = {
  name: string
  title?: string
  description?: string
  inputSchema?: JsonObject
  outputSchema?: JsonObject
  annotations?: Record<string, unknown>
}

export type McpResource = {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export type McpResourceTemplate = {
  uriTemplate: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export type McpResourceContents = {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
}

export type McpInitializeResult = {
  protocolVersion: string
  capabilities?: Record<string, unknown>
  serverInfo?: McpImplementation
  instructions?: string
}

export type McpTransport = {
  connect(): Promise<void>
  close(): Promise<void>
  request(message: JsonRpcRequest): Promise<JsonRpcResponse>
  notify(message: JsonRpcNotification): Promise<void>
  setAuthorization?(token: string): void
  setProtocolVersion?(protocolVersion: string): void
}

export type KnotworkAgentDiscovery = {
  workspace_id: string
  workspace_name: string
  auth: {
    challenge_endpoint: string
    token_endpoint: string
    key_type: string
    nonce_ttl_seconds: number
    token_lifetime_days: number
  }
  skills_endpoint: string
  mcp_server_url: string
}

export type KnotworkAgentChallenge = {
  nonce: string
  expires_at: string
}

export type KnotworkTokenResponse = {
  access_token: string
  token_type: string
}

export type KnotworkAuthSession = {
  accessToken: string
  expiresAt: string | null
  publicKey: string
}

export type KnotworkSigner = {
  getPublicKey(): Promise<string>
  sign(message: string): Promise<string>
}

export type KnotworkHttpOptions = {
  type?: 'http'
  mcpServerUrl?: string
}

export type KnotworkStdioOptions = {
  type: 'stdio'
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

export type KnotworkTransportOptions = KnotworkHttpOptions | KnotworkStdioOptions

export type CreateKnotworkMcpClientOptions = {
  backendUrl: string
  workspaceId: string
  bearerToken?: string
  privateKeyPath?: string
  signer?: KnotworkSigner
  transport?: KnotworkTransportOptions
  clientInfo?: McpImplementation
}

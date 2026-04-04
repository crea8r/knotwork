import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { KnotworkAuthError, KnotworkMcpError, McpProtocolError } from './errors.js'
import type {
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  McpTransport,
} from './types.js'

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    'jsonrpc' in value &&
    (('result' in value && 'id' in value) || ('error' in value && 'id' in value))
  )
}

function extractResponseError(response: JsonRpcResponse): string | null {
  return 'error' in response ? `${response.error.code}: ${response.error.message}` : null
}

function getHeader(response: Response, name: string): string | null {
  return response.headers.get(name) ?? response.headers.get(name.toLowerCase())
}

function parseEventStream(body: string): unknown[] {
  const messages: unknown[] = []
  for (const chunk of body.split(/\r?\n\r?\n/)) {
    const lines = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
    if (lines.length === 0) continue
    const payload = lines.join('\n')
    try {
      messages.push(JSON.parse(payload))
    } catch {
      continue
    }
  }
  return messages
}

export class StreamableHttpMcpTransport implements McpTransport {
  private readonly url: string
  private readonly extraHeaders: Record<string, string>
  private authorization: string | null
  private sessionId: string | null
  private protocolVersion: string | null

  constructor(options: {
    url: string
    bearerToken?: string
    headers?: Record<string, string>
  }) {
    this.url = options.url
    this.extraHeaders = { ...(options.headers ?? {}) }
    this.authorization = options.bearerToken ?? null
    this.sessionId = null
    this.protocolVersion = null
  }

  async connect(): Promise<void> {
    return Promise.resolve()
  }

  setAuthorization(token: string): void {
    this.authorization = token
  }

  setProtocolVersion(protocolVersion: string): void {
    this.protocolVersion = protocolVersion
  }

  async request(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    })
    for (const [name, value] of Object.entries(this.extraHeaders)) {
      headers.set(name, value)
    }
    if (this.authorization) {
      headers.set('Authorization', `Bearer ${this.authorization}`)
    }
    if (this.sessionId) {
      headers.set('Mcp-Session-Id', this.sessionId)
    }
    if (this.protocolVersion) {
      headers.set('Mcp-Protocol-Version', this.protocolVersion)
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    })

    const sessionId = getHeader(response, 'mcp-session-id')
    if (sessionId) {
      this.sessionId = sessionId
    }

    if (response.status === 401) {
      throw new KnotworkAuthError(`MCP request unauthorized: ${message.method}`)
    }

    const text = await response.text()
    if (!response.ok) {
      throw new KnotworkMcpError(
        `MCP HTTP ${response.status} for ${message.method}: ${text.slice(0, 240)}`,
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    let payloads: unknown[] = []
    if (contentType.includes('application/json')) {
      payloads = [JSON.parse(text)]
    } else if (contentType.includes('text/event-stream')) {
      payloads = parseEventStream(text)
    } else if (text.trim()) {
      throw new McpProtocolError(
        `Unsupported MCP response content-type '${contentType}' for ${message.method}`,
      )
    }

    const matched = payloads.find(
      (payload) => isJsonRpcResponse(payload) && payload.id === message.id,
    )
    if (!matched || !isJsonRpcResponse(matched)) {
      throw new McpProtocolError(`No JSON-RPC response found for ${message.method}`)
    }
    const errorText = extractResponseError(matched)
    if (errorText) {
      throw new McpProtocolError(`MCP ${message.method} failed: ${errorText}`)
    }
    return matched
  }

  async notify(message: JsonRpcNotification): Promise<void> {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    })
    for (const [name, value] of Object.entries(this.extraHeaders)) {
      headers.set(name, value)
    }
    if (this.authorization) {
      headers.set('Authorization', `Bearer ${this.authorization}`)
    }
    if (this.sessionId) {
      headers.set('Mcp-Session-Id', this.sessionId)
    }
    if (this.protocolVersion) {
      headers.set('Mcp-Protocol-Version', this.protocolVersion)
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new KnotworkMcpError(
        `MCP notification ${message.method} failed (${response.status}): ${text.slice(0, 240)}`,
      )
    }
  }

  async close(): Promise<void> {
    if (!this.sessionId) return
    const headers = new Headers()
    for (const [name, value] of Object.entries(this.extraHeaders)) {
      headers.set(name, value)
    }
    headers.set('Mcp-Session-Id', this.sessionId)
    if (this.authorization) {
      headers.set('Authorization', `Bearer ${this.authorization}`)
    }
    await fetch(this.url, { method: 'DELETE', headers }).catch(() => undefined)
    this.sessionId = null
  }
}

type PendingResolver = {
  resolve: (value: JsonRpcResponse) => void
  reject: (reason?: unknown) => void
}

function encodeStdioMessage(payload: JsonRpcRequest | JsonRpcNotification): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'utf8')
  return Buffer.concat([header, body])
}

function readContentLength(header: string): number {
  const match = header.match(/content-length:\s*(\d+)/i)
  if (!match) {
    throw new McpProtocolError(`Missing Content-Length header: ${header}`)
  }
  return Number.parseInt(match[1], 10)
}

export class StdioMcpTransport implements McpTransport {
  private readonly command: string
  private readonly args: string[]
  private readonly cwd?: string
  private readonly env?: Record<string, string>
  private child: ChildProcessWithoutNullStreams | null
  private buffer: Buffer
  private readonly pending: Map<JsonRpcId, PendingResolver>
  private protocolVersion: string | null

  constructor(options: {
    command: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
  }) {
    this.command = options.command
    this.args = options.args ?? []
    this.cwd = options.cwd
    this.env = options.env
    this.child = null
    this.buffer = Buffer.alloc(0)
    this.pending = new Map()
    this.protocolVersion = null
  }

  async connect(): Promise<void> {
    if (this.child) return
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...(this.env ?? {}) },
      stdio: 'pipe',
    })

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drainBuffer()
    })

    this.child.stderr.on('data', () => {
      return
    })

    this.child.on('error', (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error)
      }
      this.pending.clear()
    })

    this.child.on('close', (code) => {
      const error = new KnotworkMcpError(`MCP stdio process exited with code ${code ?? 'null'}`)
      for (const pending of this.pending.values()) {
        pending.reject(error)
      }
      this.pending.clear()
      this.child = null
    })
  }

  setProtocolVersion(protocolVersion: string): void {
    this.protocolVersion = protocolVersion
  }

  private drainBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString('utf8')
      const length = readContentLength(header)
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + length
      if (this.buffer.byteLength < bodyEnd) return
      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8')
      this.buffer = this.buffer.subarray(bodyEnd)
      const parsed = JSON.parse(body) as unknown
      if (!isJsonRpcResponse(parsed)) continue
      const pending = this.pending.get(parsed.id)
      if (!pending) continue
      this.pending.delete(parsed.id)
      const errorText = extractResponseError(parsed)
      if (errorText) {
        pending.reject(new McpProtocolError(`MCP response failed: ${errorText}`))
      } else {
        pending.resolve(parsed)
      }
    }
  }

  async request(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.child) {
      await this.connect()
    }
    if (!this.child?.stdin.writable) {
      throw new KnotworkMcpError('MCP stdio stdin is not writable')
    }

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject })
      this.child?.stdin.write(encodeStdioMessage(message))
    })
  }

  async notify(message: JsonRpcNotification): Promise<void> {
    if (!this.child) {
      await this.connect()
    }
    if (!this.child?.stdin.writable) {
      throw new KnotworkMcpError('MCP stdio stdin is not writable')
    }
    this.child.stdin.write(encodeStdioMessage(message))
  }

  async close(): Promise<void> {
    if (!this.child) return
    this.child.kill()
    this.child = null
    this.pending.clear()
    this.buffer = Buffer.alloc(0)
  }
}

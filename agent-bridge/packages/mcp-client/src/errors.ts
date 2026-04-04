export class KnotworkMcpError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'KnotworkMcpError'
  }
}

export class KnotworkAuthError extends KnotworkMcpError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'KnotworkAuthError'
  }
}

export class McpProtocolError extends KnotworkMcpError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'McpProtocolError'
  }
}

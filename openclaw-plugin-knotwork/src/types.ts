export type AnyObj = Record<string, unknown>

export type OpenClawApi = {
  config?: AnyObj
  pluginConfig?: AnyObj
  runtime?: {
    system?: {
      runCommandWithTimeout?: (
        argv: string[],
        options: number | { timeoutMs: number; cwd?: string; input?: string; env?: Record<string, string> },
      ) => Promise<{ stdout: string; stderr: string; code: number | null; signal: string | null; killed: boolean }>
    }
  }
  registerGatewayMethod?: (name: string, handler: (ctx: AnyObj) => Promise<void> | void) => void
  gateway?: { call?: (method: string, params?: AnyObj) => Promise<unknown> }
  agents?: { run?: (params: AnyObj) => Promise<unknown>; list?: (params?: AnyObj) => Promise<unknown> }
  runAgent?: (params: AnyObj) => Promise<unknown>
}

export type PluginConfig = {
  knotworkBaseUrl?: string
  handshakeToken?: string
  pluginInstanceId?: string
  autoHandshakeOnStart?: boolean
  taskPollIntervalMs?: number
}

export type StatusState = {
  plugin_id: string
  plugin_version: string
  plugin_instance_id: string | null
  integration_secret: string | null
  last_handshake_at: string | null
  last_handshake_ok: boolean
  last_error: string | null
  last_response: AnyObj | null
  last_task_at: string | null
  running_task_id: string | null
  recent_logs: string[]
}

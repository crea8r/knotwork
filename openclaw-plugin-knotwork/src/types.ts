// Shared types for the Knotwork-OpenClaw bridge plugin.
// No logic here — pure type declarations.

// biome-ignore lint/suspicious/noExplicitAny: required for loose OpenClaw API surface
export type AnyObj = Record<string, any>

// OpenClaw plugin API surface (subset we actually use)
export type OpenClawApi = {
  config?: AnyObj
  pluginConfig?: AnyObj
  gateway?: {
    call?: (method: string, params?: AnyObj) => Promise<unknown>
  }
  runtime?: {
    system?: {
      runCommandWithTimeout?: (
        argv: string[],
        options: number | { timeoutMs: number; cwd?: string },
      ) => Promise<{ stdout: string; stderr: string; code: number | null }>
    }
  }
  registerGatewayMethod?: (name: string, handler: (ctx: AnyObj) => Promise<void> | void) => void
  agents?: { list?: (params?: AnyObj) => Promise<unknown> }
}

// Plugin config — from openclaw.plugin.json configSchema or env vars
export type PluginConfig = {
  knotworkBaseUrl?: string
  handshakeToken?: string
  pluginInstanceId?: string
  autoHandshakeOnStart?: boolean
  taskPollIntervalMs?: number
}

// Live plugin state (exposed via knotwork.status RPC and knotwork.logs)
export type PluginState = {
  pluginInstanceId: string | null
  integrationSecret: string | null
  stateFilePath: string | null
  runtimeLockPath: string | null
  activationContext: string | null
  backgroundWorkerEnabled: boolean
  lastHandshakeAt: string | null
  lastHandshakeOk: boolean
  lastError: string | null
  lastTaskAt: string | null
  runningTaskId: string | null
  logs: string[] // rolling 200-line ring buffer; each line also written to stdout
}

// Normalised result of a single task execution
export type TaskResult =
  | { type: 'completed'; output: string; next_branch: string | null }
  | { type: 'escalation'; question: string; options: string[]; message?: string }
  | { type: 'failed'; error: string }

// Agent discovered from OpenClaw runtime (sent to Knotwork on handshake)
export type RemoteAgent = {
  remote_agent_id: string
  slug: string
  display_name: string
  description?: string   // short human-readable description of what the agent does
  tools: AnyObj[]
  constraints: AnyObj
}

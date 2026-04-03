// Shared types for the Knotwork-OpenClaw bridge plugin.

export type JsonPrimitive = string | number | boolean | null
export interface JsonObject {
  [key: string]: JsonValue
}
export interface JsonArray extends Array<JsonValue> {}
export type JsonValue = JsonPrimitive | JsonObject | JsonArray

export type LooseRecord = Record<string, unknown>

// GatewayMethodContext matches the real GatewayRequestHandlerOptions shape from OpenClaw.
// Handlers receive { params, respond, ... } — params holds the RPC call arguments.
export type GatewayMethodContext = {
  params: Record<string, unknown>
  respond: (ok: boolean, payload?: unknown) => void
  [key: string]: unknown
}

export type OpenClawApi = {
  config?: LooseRecord
  pluginConfig?: LooseRecord
  runtime?: LooseRecord
  registerGatewayMethod?: (
    name: string,
    handler: (ctx: GatewayMethodContext) => Promise<void> | void,
  ) => void
  on?: (hookName: string, handler: (...args: unknown[]) => unknown) => void
  agents?: {
    list?: (params?: LooseRecord) => Promise<unknown>
  }
}

export type PluginConfig = {
  knotworkBackendUrl?: string
  workspaceId?: string        // Knotwork workspace UUID
  privateKeyPath?: string     // Path to ed25519 private key PEM file
  pluginInstanceId?: string
  autoAuthOnStart?: boolean   // renamed from autoHandshakeOnStart
  taskPollIntervalMs?: number // inbox poll interval (reuses existing config key)
}

export type RemoteTool = {
  name: string
  description: string
  input_schema?: JsonObject
}

export type RemoteAgent = {
  remote_agent_id: string
  slug: string
  display_name: string
  description?: string
  tools: RemoteTool[]
  constraints: LooseRecord
}

/** A single item from GET /workspaces/{id}/inbox */
export type InboxEvent = {
  id: string
  item_type: string   // "escalation" | "mentioned_message" | "task_assigned" | "run_event" | ...
  delivery_id: string | null
  title: string
  subtitle: string | null
  status: string
  run_id: string | null
  channel_id: string | null
  escalation_id: string | null
  proposal_id: string | null
  unread: boolean
  created_at: string
}

export type ExecutionTask = {
  task_id: string
  node_id?: string
  run_id?: string
  workspace_id?: string
  agent_key?: string
  remote_agent_id?: string
  agent_id?: string
  session_name?: string
  system_prompt?: string
  user_prompt?: string
}

export type RecentTask = {
  taskId: string
  nodeId: string | null
  runId: string | null
  sessionName: string | null
  status: string
  startedAt: string
  finishedAt: string | null
  error: string | null
}

/** Tracks a task whose gateway spawn is currently in-flight. */
export type RunningTaskInfo = {
  taskId: string
  nodeId: string | null
  runId: string | null
  sessionName: string | null
  /** ISO timestamp when the spawn was initiated. */
  startedAt: string
  /** How the task was triggered: background poll or explicit RPC call. */
  spawnContext: 'poll' | 'rpc'
}

export type PluginState = {
  pluginInstanceId: string | null
  jwt: string | null              // Bearer token from ed25519 auth (replaces integrationSecret)
  jwtExpiresAt: string | null     // ISO timestamp for auto-renewal
  guideContent: string | null     // cached workspace guide markdown
  guideVersion: number | null     // version number for change detection
  stateFilePath: string | null
  runtimeLockPath: string | null
  activationContext: string | null
  backgroundWorkerEnabled: boolean
  lastAuthAt: string | null       // renamed from lastHandshakeAt
  lastAuthOk: boolean             // renamed from lastHandshakeOk
  lastError: string | null
  lastTaskAt: string | null
  /** @deprecated Use runningTasks[]. Kept for backward compat with persisted state. */
  runningTaskId: string | null
  /** All currently in-flight task spawns. */
  runningTasks: RunningTaskInfo[]
  runtimeLeaseOwnerPid: number | null
  recentTasks: RecentTask[]
  logs: string[]
}

export type TaskResult =
  | { type: 'completed'; output: string; next_branch: string | null }
  | { type: 'escalation'; questions: string[]; options: string[]; message?: string }
  | { type: 'failed'; error: string }

/** Parameters passed to a subprocess via --params so it can run without reading persisted state. */
export type SubprocessParams = {
  task: ExecutionTask
  pluginInstanceId: string
  jwt: string             // replaces integrationSecret
  knotworkUrl: string
  workspaceId: string
  taskLogPath: string
}

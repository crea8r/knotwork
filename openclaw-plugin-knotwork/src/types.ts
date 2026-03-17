// Shared types for the Knotwork-OpenClaw bridge plugin.

export type JsonPrimitive = string | number | boolean | null
export interface JsonObject {
  [key: string]: JsonValue
}
export interface JsonArray extends Array<JsonValue> {}
export type JsonValue = JsonPrimitive | JsonObject | JsonArray

export type LooseRecord = Record<string, unknown>

export type GatewayCall = (method: string, params?: LooseRecord) => Promise<unknown>

export type GatewayMethodContext = {
  request?: {
    payload?: LooseRecord
  }
  payload?: LooseRecord
  respond?: (ok: boolean, payload: LooseRecord) => void
}

export type OpenClawApi = {
  config?: LooseRecord
  pluginConfig?: LooseRecord
  gateway?: {
    call?: GatewayCall
  }
  runtime?: {
    system?: {
      runCommandWithTimeout?: (
        argv: string[],
        options: number | { timeoutMs: number; cwd?: string },
      ) => Promise<{ stdout: string; stderr: string; code: number | null }>
    }
  }
  registerGatewayMethod?: (
    name: string,
    handler: (ctx: GatewayMethodContext) => Promise<void> | void,
  ) => void
  agents?: {
    list?: (params?: LooseRecord) => Promise<unknown>
  }
}

export type PluginConfig = {
  knotworkBackendUrl?: string
  handshakeToken?: string
  pluginInstanceId?: string
  autoHandshakeOnStart?: boolean
  taskPollIntervalMs?: number
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

export type HandshakeResponse = {
  plugin_instance_id?: string
  integration_secret?: string
} & LooseRecord

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
  runtimeLeaseOwnerPid: number | null
  recentTasks: RecentTask[]
  logs: string[]
}

export type TaskResult =
  | { type: 'completed'; output: string; next_branch: string | null }
  | { type: 'escalation'; question: string; options: string[]; message?: string }
  | { type: 'failed'; error: string }

export type WsFrame = {
  type: string
  id?: string
  event?: string
  ok?: boolean
  payload?: unknown
  error?: unknown
}

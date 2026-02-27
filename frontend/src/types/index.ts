// Core domain types — mirror backend Pydantic schemas.
// Keep in sync with backend schemas when they are implemented.

export type NodeType = 'llm_agent' | 'human_checkpoint' | 'conditional_router' | 'tool_executor'
export type RunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
export type NodeStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'skipped'
export type EscalationType = 'low_confidence' | 'checkpoint_failure' | 'human_checkpoint' | 'node_error'
export type EscalationResolution = 'approved' | 'edited' | 'guided' | 'aborted'

export interface GraphVersion {
  id: string
  graph_id: string
  definition: GraphDefinition
  note: string | null
  created_at: string
}

export interface Graph {
  id: string
  workspace_id: string
  name: string
  description: string | null
  status: 'draft' | 'active' | 'archived'
  default_model: string | null
  latest_version: GraphVersion | null
  created_at: string
  updated_at: string
}

export interface GraphDefinition {
  nodes: NodeDef[]
  edges: EdgeDef[]
}

export interface NodeDef {
  id: string
  type: NodeType
  name: string
  position?: { x: number; y: number }  // optional — dagre computes layout
  note?: string
  // type-specific fields stored in config
  config: Record<string, unknown>
}

export interface EdgeDef {
  id: string
  source: string
  target: string
  type: 'direct' | 'conditional'
  condition_label?: string
}

export interface Run {
  id: string
  graph_id: string
  status: RunStatus
  trigger: 'manual' | 'api' | 'schedule'
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  eta_seconds: number | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface RunNodeState {
  id: string
  run_id: string
  node_id: string
  status: NodeStatus
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
  knowledge_snapshot: Record<string, string> | null
  resolved_token_count: number | null
  confidence_score: number | null
  retry_count: number
  error: string | null
  started_at: string | null
  completed_at: string | null
}

export interface KnowledgeFile {
  id: string
  workspace_id: string
  path: string
  title: string
  owner_id: string | null
  raw_token_count: number
  resolved_token_count: number
  linked_paths: string[]
  current_version_id: string | null
  health_score: number | null
  updated_at: string
}

export interface Escalation {
  id: string
  run_id: string
  node_id: string
  workspace_id: string
  type: EscalationType
  status: 'open' | 'resolved' | 'timed_out'
  context: Record<string, unknown>
  timeout_at: string | null
  resolution: EscalationResolution | null
  created_at: string
}

export interface Tool {
  id: string
  workspace_id: string | null
  name: string
  slug: string
  category: 'function' | 'http' | 'rag' | 'lookup' | 'rule' | 'builtin'
  scope: 'workspace' | 'graph' | 'node'
  definition: Record<string, unknown>
}

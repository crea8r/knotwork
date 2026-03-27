// Core domain types — mirror backend Pydantic schemas.
// Keep in sync with backend schemas when they are implemented.

/** S7: 'agent' is the unified type. Legacy types kept for backward-compat display only. */
export type NodeType = 'agent' | 'llm_agent' | 'human_checkpoint' | 'conditional_router' | 'tool_executor' | 'start' | 'end'
/** trust_level is now a float 0.0–1.0. Legacy string enum kept for backward-compat display. */
export type TrustLevel = number
export type RunStatus = 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
export type NodeStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'skipped'
export type EscalationType = 'low_confidence' | 'checkpoint_failure' | 'human_checkpoint' | 'agent_question' | 'confidence' | 'node_error'
export type EscalationResolution =
  | 'accept_output'
  | 'override_output'
  | 'request_revision'
  | 'abort_run'
  // Backward-compatible aliases:
  | 'approved'
  | 'edited'
  | 'guided'
  | 'aborted'

export interface GraphVersion {
  id: string
  graph_id: string
  definition: GraphDefinition
  note: string | null
  // S9.1 versioning fields — null while record is a draft
  version_id: string | null        // 9-char stable ID; null = draft
  version_name: string | null      // coolname slug; null for drafts
  version_created_at: string | null
  parent_version_id: string | null // lineage pointer
  archived_at: string | null
  is_public: boolean
  version_slug: string | null
  public_description_md: string | null
  updated_at: string
  created_at: string
  // Enriched by list endpoint
  draft: GraphVersion | null       // the draft based on this version (if any)
  run_count: number
}

export interface Graph {
  id: string
  workspace_id: string
  project_id: string | null
  name: string
  path: string
  description: string | null
  status: 'draft' | 'active' | 'archived'
  default_model: string | null
  production_version_id: string | null  // S9.1
  slug: string | null                   // S9.1 public URL slug
  run_count: number
  latest_version: GraphVersion | null
  created_at: string
  updated_at: string
}

export interface InputFieldDef {
  name: string
  label: string
  description: string
  required: boolean
  type: 'text' | 'textarea' | 'number'
}

export interface GraphDefinition {
  nodes: NodeDef[]
  edges: EdgeDef[]
  entry_point?: string | null
  input_schema?: InputFieldDef[]
}

export interface NodeDef {
  id: string
  type: NodeType
  name: string
  position?: { x: number; y: number }  // optional — dagre computes layout
  note?: string
  /** S7: which agent handles this node, e.g. "anthropic:claude-3-5-sonnet-20241022" or "human" */
  agent_ref?: string
  /** S7: how much autonomy the agent has */
  trust_level?: TrustLevel
  /** S7.1: UUID of registered agent — used to look up per-workspace API key at runtime */
  registered_agent_id?: string | null
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
  workspace_id: string
  project_id: string | null
  objective_id: string | null
  graph_id: string
  graph_version_id: string | null   // S9.1: nullable; null for legacy runs
  // S9.1 draft run metadata
  draft_snapshot_at: string | null
  draft_parent_version_id: string | null
  name: string | null
  status: RunStatus
  trigger: 'manual' | 'api' | 'schedule'
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  eta_seconds: number | null
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  // Enriched fields
  total_tokens: number | null
  output_summary: string | null
  needs_attention: boolean
}

/** True when a run was executed against a draft (not a named version). */
export function isDraftRun(run: Run): boolean {
  return run.draft_snapshot_at != null
}

export interface PublicWorkflowLink {
  id: string
  workspace_id: string
  graph_id: string
  graph_version_id: string | null
  token: string
  description_md: string
  status: 'active' | 'disabled'
  created_at: string
  updated_at: string
}

export interface PublicWorkflowView {
  description_md: string
  resolved_version_slug: string | null
  input_schema: InputFieldDef[]
  rate_limit_max_requests: number
  rate_limit_window_seconds: number
  notice_test_only: boolean
  notice_future_paid: boolean
}

export interface PublicRunTriggerOut {
  run_id: string
  run_token: string
  run_public_url: string
}

export interface PublicRunView {
  description_md: string
  input: Record<string, unknown>
  final_output: string | null
  status: 'processing' | 'completed'
  email_subscribed: boolean
}

export interface RunNodeState {
  id: string
  run_id: string
  node_id: string
  node_name: string | null
  agent_ref: string | null
  status: NodeStatus
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
  agent_logs: unknown[]
  next_branch: string | null
  knowledge_snapshot: Record<string, string> | null
  resolved_token_count: number | null
  confidence_score: number | null
  retry_count: number
  error: string | null
  started_at: string | null
  completed_at: string | null
}

export interface OpenAICallLog {
  id: string
  workspace_id: string
  workflow_id: string | null
  run_id: string
  run_node_state_id: string | null
  node_id: string
  agent_ref: string | null
  provider: string
  openai_assistant_id: string | null
  openai_thread_id: string | null
  openai_run_id: string | null
  request_payload: Record<string, unknown>
  response_payload: Record<string, unknown> | null
  status: string
  created_at: string
  updated_at: string
}

export interface RunWorklogEntry {
  id: string
  run_id: string
  node_id: string
  agent_ref: string | null
  entry_type: string
  content: string
  metadata_: Record<string, unknown>
  created_at: string
}

export interface RunHandbookProposal {
  id: string
  run_id: string
  node_id: string
  agent_ref: string | null
  path: string
  proposed_content: string
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'edited'
  reviewed_by: string | null
  reviewed_at: string | null
  final_content: string | null
  created_at: string
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
  run_node_state_id: string
  node_id: string
  workspace_id: string
  type: EscalationType
  status: 'open' | 'resolved' | 'timed_out'
  context: Record<string, unknown>
  timeout_at: string | null
  resolution: EscalationResolution | null
  resolution_data: Record<string, unknown> | null
  resolved_at: string | null
  created_at: string
}

export interface Channel {
  id: string
  workspace_id: string
  name: string
  channel_type: 'normal' | 'workflow' | 'handbook' | 'agent_main' | 'project' | 'objective'
  graph_id: string | null
  project_id: string | null
  objective_id: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface ProjectStatusUpdate {
  id: string
  workspace_id: string
  project_id: string
  author_type: string
  author_name: string | null
  summary: string
  created_at: string
}

export interface Project {
  id: string
  workspace_id: string
  title: string
  description: string
  status: 'open' | 'in_progress' | 'blocked' | 'done'
  deadline: string | null
  project_channel_id: string | null
  objective_count: number
  open_objective_count: number
  run_count: number
  latest_status_update: ProjectStatusUpdate | null
  created_at: string
  updated_at: string
}

export interface Objective {
  id: string
  workspace_id: string
  project_id: string | null
  parent_objective_id: string | null
  code: string | null
  title: string
  description: string | null
  status: 'open' | 'in_progress' | 'blocked' | 'done'
  progress_percent: number
  status_summary: string | null
  key_results: string[]
  owner_type: string | null
  owner_name: string | null
  deadline: string | null
  origin_type: string
  origin_graph_id: string | null
  channel_id: string | null
  run_count: number
  latest_run_id: string | null
  created_at: string
  updated_at: string
}

export interface ProjectDocument {
  id: string
  workspace_id: string
  project_id: string | null
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

export interface ProjectDocumentWithContent extends ProjectDocument {
  content: string
  version_id: string
}

export interface ProjectDashboard {
  project: Project
  objectives: Objective[]
  recent_runs: Run[]
  blocked_objectives: Objective[]
  latest_status_update: ProjectStatusUpdate | null
}

export interface ChannelMessage {
  id: string
  workspace_id: string
  channel_id: string
  run_id: string | null
  node_id: string | null
  role: 'user' | 'assistant' | 'system'
  author_type: 'human' | 'agent' | 'system'
  author_name: string | null
  content: string
  metadata_: Record<string, unknown>
  created_at: string
}

export interface DecisionEvent {
  id: string
  workspace_id: string
  channel_id: string | null
  run_id: string | null
  escalation_id: string | null
  decision_type: string
  actor_type: 'human' | 'agent' | 'system'
  actor_name: string | null
  payload: Record<string, unknown>
  created_at: string
}

export interface InboxItem {
  id: string
  item_type: 'escalation' | 'handbook_proposal' | 'mentioned_message' | 'task_assigned' | 'run_event'
  delivery_id: string | null
  title: string
  subtitle: string | null
  status: string
  run_id: string | null
  channel_id: string | null
  escalation_id: string | null
  proposal_id: string | null
  due_at: string | null
  created_at: string
  unread: boolean
  archived_at: string | null
}

export interface InboxSummary {
  unread_count: number
  active_count: number
  archived_count: number
}

export interface ParticipantMentionOption {
  participant_id: string
  display_name: string
  mention_handle: string | null
  kind: 'human' | 'agent'
  email: string | null
}

export interface ChannelSubscription {
  channel_id: string
  participant_id: string
  subscribed: boolean
  subscribed_at: string | null
  unsubscribed_at: string | null
}

export interface ChannelAssetBinding {
  id: string
  channel_id: string
  asset_type: 'workflow' | 'run' | 'file'
  asset_id: string
  display_name: string
  path: string | null
  status: string | null
  created_at: string
}

export interface ParticipantDeliveryPreference {
  participant_id: string
  event_type: string
  app_enabled: boolean
  email_enabled: boolean
  plugin_enabled: boolean
  email_address: string | null
}

export interface ParticipantDeliveryPreferenceBundle {
  participant_id: string
  kind: 'human' | 'agent'
  display_name: string
  event_types: ParticipantDeliveryPreference[]
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

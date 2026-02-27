# Data Models

## Workspace

```
Workspace
  id                uuid  PK
  name              text
  slug              text  unique
  default_model     text          -- e.g. "openai/gpt-4o"
  confidence_min    int           -- workspace default: too-sparse threshold (tokens)
  confidence_max    int           -- workspace default: too-large threshold (tokens)
  created_at        timestamptz
  updated_at        timestamptz
```

---

## User & Role

```
User
  id                uuid  PK
  email             text  unique
  name              text
  avatar_url        text
  telegram_chat_id  text  nullable
  whatsapp_number   text  nullable
  created_at        timestamptz

WorkspaceMember
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  user_id           uuid  FK → User
  role              enum  [owner, operator]
  notification_prefs jsonb
    -- {
    --   escalation: { channels: ["in_app", "telegram"], ... },
    --   digest: { channels: ["email"], frequency: "daily", time: "08:00", tz: "Asia/Ho_Chi_Minh" }
    -- }
  created_at        timestamptz
```

---

## Graph

```
Graph
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  name              text
  description       text  nullable
  status            enum  [draft, active, archived]
  default_model     text  nullable      -- overrides workspace default
  trigger_config    jsonb
    -- {
    --   manual: true,
    --   api: true,
    --   schedule: { cron: "0 9 * * 1-5", timezone: "Asia/Ho_Chi_Minh" }  -- Phase 2
    -- }
  created_by        uuid  FK → User
  created_at        timestamptz
  updated_at        timestamptz

GraphVersion
  id                uuid  PK
  graph_id          uuid  FK → Graph
  definition        jsonb         -- full snapshot of nodes + edges at this version
  created_by        uuid  FK → User
  created_at        timestamptz
  note              text  nullable
```

---

## Node

Nodes are stored as part of the graph definition JSON, not as separate DB rows. The schema below describes the structure within that JSON.

```
Node (within GraphVersion.definition)
  id                string        -- unique within the graph
  type              enum  [llm_agent, human_checkpoint, conditional_router, tool_executor, subgraph]
  name              text
  position          { x: float, y: float }
  note              text  nullable
  tags              string[]

  -- LLM Agent fields
  knowledge         string[]      -- knowledge fragment paths
  model             text  nullable
  tools             ToolRef[]
  output_schema     object        -- JSON schema
  confidence_field  string        -- field name in output
  confidence_threshold  float     -- 0–1
  confidence_rules  ConfidenceRule[]
  checkpoints       Checkpoint[]
  fail_safe         FailSafeConfig
  retry_limit       int
  input_mapping     { state_field: node_param }
  output_mapping    { node_output: state_field }

  -- Human Checkpoint fields
  prompt            text
  context_fields    string[]
  response_type     enum  [approve_reject, choice, freetext]
  choices           Choice[]  nullable
  timeout_hours     int
  notify            enum[]  [in_app, email, telegram, whatsapp]

  -- Conditional Router fields
  conditions        Condition[]
  default_target    string  nullable

  -- Tool Executor fields
  tool              ToolRef
  error_handling    enum  [retry, escalate, skip]

  -- Sub-graph fields (Phase 2)
  subgraph_id       uuid
  timeout_minutes   int

ToolRef
  tool_id           uuid
  version           string    -- version_id or "latest"
  overrides         object    nullable

Checkpoint
  id                string
  name              text
  type              enum  [rule, llm]  -- llm is Phase 2
  expression        text   -- for rule type
  fail_message      text

ConfidenceRule
  condition         text   -- expression
  set               float  -- override value

FailSafeConfig
  action            enum  [retry, escalate, skip, route]
  route_to          string  nullable  -- node ID if action is route

Choice
  label             text
  goto              string  -- node ID
```

---

## Edge

Edges are stored within the graph definition JSON.

```
Edge (within GraphVersion.definition)
  id                string
  source            string   -- node ID
  target            string   -- node ID
  type              enum  [direct, conditional]
  condition_label   text  nullable  -- display label for conditional edges
```

---

## Knowledge

```
KnowledgeFile
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  path              text          -- e.g. "contracts/purchase-guide.md"
  title             text          -- first H1 or filename
  owner_id          uuid  FK → User
  current_version_id text
  raw_token_count   int           -- tokens in this file only
  resolved_token_count int        -- tokens in full linked tree
  linked_paths      text[]        -- direct [[links]] found in file
  access_policy     jsonb
    -- {
    --   workspace_read: true,
    --   shared_with: [{ user_id: "...", access: "edit" }]
    -- }
  created_at        timestamptz
  updated_at        timestamptz

KnowledgeVersion
  id                uuid  PK
  file_id           uuid  FK → KnowledgeFile
  storage_version_id text          -- S3 version ID or local FS version
  saved_by          uuid  FK → User  -- or null if saved by agent
  agent_id          uuid  nullable  -- if saved by agent
  change_summary    text  nullable
  created_at        timestamptz

KnowledgeHealthLog
  id                uuid  PK
  file_id           uuid  FK → KnowledgeFile
  score             float         -- 0.0–1.0
  token_score       float         -- sub-score: token count in range
  confidence_score  float         -- sub-score: avg confidence across recent runs
  escalation_score  float         -- sub-score: inverse escalation rate
  rating_score      float         -- sub-score: avg human rating
  run_count         int           -- number of runs included in calculation
  computed_at       timestamptz
```

---

## Tool

```
Tool
  id                uuid  PK
  workspace_id      uuid  FK → Workspace  -- null if built-in
  graph_id          uuid  FK → Graph  nullable  -- if graph-scoped
  name              text
  slug              text  -- used in code/YAML references
  category          enum  [function, http, rag, lookup, rule, builtin]
  scope             enum  [workspace, graph, node]
  definition        jsonb         -- category-specific config
  current_version   text
  created_by        uuid  FK → User
  created_at        timestamptz
  updated_at        timestamptz

ToolVersion
  id                uuid  PK
  tool_id           uuid  FK → Tool
  definition        jsonb
  created_by        uuid  FK → User
  created_at        timestamptz
  note              text  nullable
```

---

## Run

```
Run
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  graph_id          uuid  FK → Graph
  graph_version_id  uuid  FK → GraphVersion
  status            enum  [queued, running, paused, completed, failed, stopped]
  trigger           enum  [manual, api, schedule]
  trigger_meta      jsonb         -- e.g. { api_key_id: "...", caller_ip: "..." }
  input             jsonb         -- initial run state (structured fields)
  context_files     jsonb         -- Run Context attachments: [{name, storage_path, mime_type, size}]
  output            jsonb  nullable  -- final run state on completion
  eta_seconds       int    nullable  -- estimated seconds to completion
  started_at        timestamptz  nullable
  completed_at      timestamptz  nullable
  created_at        timestamptz
  created_by        uuid  FK → User  nullable  -- null for API/schedule triggers

RunNodeState
  id                uuid  PK
  run_id            uuid  FK → Run
  node_id           string        -- matches node ID in graph definition
  status            enum  [pending, running, paused, completed, failed, skipped]
  input             jsonb
  output            jsonb  nullable
  knowledge_snapshot jsonb
    -- { "contracts/purchase-guide.md": "version_id_abc", ... }
  resolved_token_count int  nullable
  confidence_score  float  nullable
  retry_count       int    default 0
  started_at        timestamptz  nullable
  completed_at      timestamptz  nullable
  error             text  nullable
```

---

## Escalation

```
Escalation
  id                uuid  PK
  run_id            uuid  FK → Run
  run_node_state_id uuid  FK → RunNodeState
  workspace_id      uuid  FK → Workspace
  type              enum  [low_confidence, checkpoint_failure, human_checkpoint, node_error]
  status            enum  [open, resolved, timed_out]
  context           jsonb         -- what the operator sees
  assigned_to       uuid[]        -- operator user IDs
  timeout_at        timestamptz
  resolved_by       uuid  FK → User  nullable
  resolved_at       timestamptz  nullable
  resolution        enum  [approved, edited, guided, aborted]  nullable
  resolution_data   jsonb  nullable
    -- edited: { output: {...} }
    -- guided: { guidance: "..." }
  created_at        timestamptz
```

---

## Rating

```
Rating
  id                uuid  PK
  run_id            uuid  FK → Run
  run_node_state_id uuid  FK → RunNodeState
  workspace_id      uuid  FK → Workspace
  rated_by          uuid  FK → User  nullable   -- null if LLM judge
  source            enum  [human, llm_judge]
  score             int           -- 1–5
  comment           text  nullable
  knowledge_snapshot jsonb        -- copy from RunNodeState for traceability
  created_at        timestamptz
```

---

## Notification

```
NotificationLog
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  escalation_id     uuid  FK → Escalation  nullable
  recipient_id      uuid  FK → User
  channel           enum  [in_app, email, telegram, whatsapp]
  status            enum  [pending, sent, failed]
  sent_at           timestamptz  nullable
  error             text  nullable
  created_at        timestamptz
```

---

## Audit Log

```
AuditLog
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  actor_id          uuid  FK → User  nullable
  actor_agent_id    uuid  nullable   -- if action was by an agent
  action            text             -- e.g. "knowledge.update", "run.trigger", "escalation.resolve"
  resource_type     text             -- e.g. "knowledge_file", "graph", "run"
  resource_id       text
  before            jsonb  nullable
  after             jsonb  nullable
  metadata          jsonb  nullable
  created_at        timestamptz
```

# Data Models — Graph Definition

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

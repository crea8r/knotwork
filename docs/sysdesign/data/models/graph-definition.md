# Data Models — Graph Definition

## Graph

```
Graph
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  name              text
  description       text  nullable
  status            enum  [draft, active, archived]
  default_model     text  nullable  -- fallback for _resolve_agent_ref() on unregistered nodes
  trigger_config    jsonb
    -- {
    --   manual: true,
    --   api: true,
    --   schedule: { cron: "0 9 * * 1-5", timezone: "Asia/Ho_Chi_Minh" }  -- Phase 2
    -- }
  created_by        uuid  FK → User
  created_at        timestamptz
  updated_at        timestamptz

  -- Note: input_schema is stored inside GraphVersion.definition JSON, not as a Graph column.

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

As of S7 all execution nodes use the unified **Agent** type. <span style="color:#c1121f;font-weight:700">LEGACY</span> types (`llm_agent`, `human_checkpoint`) execute via backward-compatible fallbacks in `_resolve_agent_ref()` but should be migrated to `agent`. `tool_executor` raises a `RuntimeError` at graph compilation time.

```
Node (within GraphVersion.definition)
  id                    string        -- unique within the graph
  type                  enum  [agent, conditional_router, start, end, subgraph]
  name                  text
  position              { x: float, y: float }
  note                  text  nullable

  -- Agent fields (type: agent)
  agent_ref             string        -- "anthropic:claude-sonnet-4-6" | "openai:gpt-4o" | "human"
  registered_agent_id   uuid | null   -- FK → RegisteredAgent; overrides env-var API key at runtime
  trust_level           enum  [user_controlled, supervised, autonomous]
  system_prompt         text  nullable   -- appended after GUIDELINES in the agent prompt
  knowledge_paths       string[]         -- handbook fragment paths to load for this node
  input_sources         string[] | null  -- ["run_input", <node_id>, ...]; null = all (default)
  confidence_threshold  float            -- 0–1, default 0.70
  confidence_rules      ConfidenceRule[]
  checkpoints           Checkpoint[]
  question              text  nullable   -- prompt shown to operator (human agent only)

  -- LEGACY Conditional Router fields (type: conditional_router)
  conditions            Condition[]
  default               string  nullable  -- target node ID if no condition matches

  -- Sub-graph fields (type: subgraph, Phase 2)
  graph_id              uuid
  input_mapping         object
  output_mapping        object
  timeout               int

Checkpoint
  id                string
  name              text
  expression        text     -- evaluated against {"output": ...}
  fail_message      text

ConfidenceRule
  if                text     -- expression evaluated against {"output": ...}
  set               float    -- override confidence value

Condition
  if                string   -- expression evaluated against run state
  goto              string   -- target node ID
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

## Graph Validation Rules

Every graph must pass these checks before a run can be triggered (enforced by `runtime/validation.py` and mirrored in `frontend/src/utils/validateGraph.ts`):

- Exactly one `start` node
- At least one `end` node
- All node IDs referenced in edges exist in the node list
- No isolated nodes (unreachable from start)
- `tool_executor` nodes are rejected (RuntimeError)

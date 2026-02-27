# Data Models — Knowledge & Tools

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

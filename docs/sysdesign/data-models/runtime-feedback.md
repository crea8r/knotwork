# Data Models — Runtime & Feedback

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

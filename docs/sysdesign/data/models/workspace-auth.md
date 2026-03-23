# Data Models — Workspace & Auth

## Workspace

```
Workspace
  id                uuid  PK
  name              text
  slug              text  unique
  default_model     text          -- ⚠️ LEGACY (superseded S9+): was fallback model for _resolve_agent_ref().
                                  --   Superseded by OpenClaw connection as default runtime.
                                  --   Direct provider keys remain supported via RegisteredAgent.
  token_count_min   int           -- knowledge too-sparse threshold (default: 300 tokens)
  token_count_max   int           -- knowledge too-large threshold (default: 6000 tokens)
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

## Registered Agent

Per-workspace AI agent credential store (added in S7.1). Each record links a human-readable
display name to a provider model and an API key.

```
RegisteredAgent
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  display_name      text          -- "My Legal Claude", "GPT-4o Analyst"
  provider          enum  [anthropic, openai, openclaw]
  agent_ref         string        -- "anthropic:claude-sonnet-4-6", "openai:gpt-4o"
  api_key           text nullable -- stored plaintext (MVP); null for openclaw
  endpoint          text nullable -- future openclaw endpoint URL
  role              enum  [specialist, orchestrator]  -- default: specialist
                                  -- orchestrator = Agent Zero semantics (S12+)
                                  -- only one orchestrator per workspace
  is_active         bool          -- soft-delete; preserves node references
  created_at        timestamptz
```

`agent_ref` is the value passed to `get_adapter()` at runtime. When a node has
`registered_agent_id` set, the runtime fetches the key from this table instead of using the
env-var default.

API: `GET/POST /api/v1/workspaces/:id/agents`, `DELETE .../agents/:agent_id`

S8 expands this model with capability snapshots, preflight runs/tests, usage facts, debug refs,
and avatar assets. See:
[agents-settings-profile.md](/Users/hieu/Work/crea8r/knotwork/docs/sysdesign/data/models/agents-settings-profile.md)

---

## Workspace Representative

A **Representative** is a WorkspaceMember or RegisteredAgent designated as in charge of external interactions on behalf of the workspace (S12+). Multiple representatives are supported.

Knotwork routes escalations and task notifications to representatives rather than to generic workspace members. Representatives use their own tools (email, Slack, etc.) to handle external communication — Knotwork does not manage those channels.

```
WorkspaceRepresentative
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  member_id         uuid  FK → WorkspaceMember  nullable
  agent_id          uuid  FK → RegisteredAgent  nullable
                         -- exactly one of member_id or agent_id must be set
  is_primary        bool          -- primary representative receives notifications first
  created_at        timestamptz
```

Representatives call Knotwork via MCP or REST API when structured work needs executing. See [concepts/representatives.md](../concepts/representatives.md) for the full interaction model.

API: `GET/POST /api/v1/workspaces/:id/representatives`, `DELETE .../representatives/:id`

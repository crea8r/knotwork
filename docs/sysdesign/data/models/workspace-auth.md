# Data Models — Workspace & Auth

## Workspace

```
Workspace
  id                uuid  PK
  name              text
  slug              text  unique
  default_model     text          -- fallback model string used by _resolve_agent_ref()
                                  -- when a node has no agent_ref and no registered_agent_id
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

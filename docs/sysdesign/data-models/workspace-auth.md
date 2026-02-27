# Data Models — Workspace & Auth

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

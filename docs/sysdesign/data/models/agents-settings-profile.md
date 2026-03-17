# Data Models — S8 Agents (Settings + Profile)

> **Chat-first revision (latest):**
> - Agent capability provenance includes preflight chat transcript in `channel_messages`.
> - Run timeline provenance uses persisted run chat messages (`channel_messages.run_id`).
> - Internal channel types (`agent_main`, `run`) represent session scopes.

## Status

**Contract level:** Pre-implementation schema contract for Session 8.

This model supports:
1. `Settings > Agents` onboarding and operations.
2. `Agent Profile` capability/history/debug surfaces.
3. OpenClaw plugin handshake and remote-agent binding.

> <span style="color:#c1121f;font-weight:700">LEGACY</span>: S7.1 `registered_agents` is minimal and lacks capability/preflight/history contracts.

---

## Core Tables

## 1) `registered_agents` (extended)

```
registered_agents
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  display_name            text not null
  provider                text not null  -- openclaw | openai | anthropic
  agent_ref               text not null
  endpoint                text null      -- <span style="color:#c1121f;font-weight:700">LEGACY</span> direct connectivity path
  credential_type         text null      -- api_key | oauth_token | none
  credential_ciphertext   text null      -- encrypted at rest
  credential_hint         text null      -- masked hint for UI
  status                  text not null default 'inactive'
  avatar_asset_id         uuid null FK -> media_assets.id

  capability_version      text null
  capability_hash         text null
  capability_refreshed_at timestamptz null
  capability_freshness    text not null default 'needs_refresh'

  preflight_status        text not null default 'never_run'
  preflight_run_at        timestamptz null
  baseline_preflight_run_id uuid null

  openclaw_integration_id uuid null
  openclaw_remote_agent_id text null

  last_used_at            timestamptz null
  archived_at             timestamptz null
  created_at              timestamptz not null
  updated_at              timestamptz not null
```

Notes:
1. Keep backward-compatible columns (`api_key`, `is_active`) during migration window.
2. New logic should treat `status` as source of truth.
3. `openai` and `anthropic` records are <span style="color:#c1121f;font-weight:700">LEGACY / TRANSITIONAL</span>.

## 2) `agent_capability_snapshots`

Stores capability manifest snapshots per refresh.

```
agent_capability_snapshots
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  agent_id                uuid FK -> registered_agents.id
  version                 text null
  hash                    text not null
  source                  text not null default 'refresh'  -- refresh | import | bootstrap

  tools_json              jsonb not null default '[]'::jsonb
  constraints_json        jsonb not null default '{}'::jsonb
  policy_notes_json       jsonb not null default '[]'::jsonb
  raw_contract_json       jsonb not null default '{}'::jsonb

  changed_from_previous   boolean not null default false
  created_at              timestamptz not null
```

## 3) `agent_preflight_runs`

One preflight execution (suite-level aggregate).

```
agent_preflight_runs
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  agent_id                uuid FK -> registered_agents.id

  suite_name              text not null default 'default'
  include_optional        boolean not null default false
  status                  text not null  -- running | pass | warning | fail

  required_total          int not null default 0
  required_passed         int not null default 0
  optional_total          int not null default 0
  optional_passed         int not null default 0
  pass_rate               numeric(5,4) not null default 0
  median_latency_ms       int null
  failed_count            int not null default 0

  is_baseline             boolean not null default false
  created_by              uuid null FK -> users.id
  started_at              timestamptz not null
  completed_at            timestamptz null
  created_at              timestamptz not null
```

## 4) `agent_preflight_tests`

Per-test row under a preflight run.

```
agent_preflight_tests
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  preflight_run_id        uuid FK -> agent_preflight_runs.id
  agent_id                uuid FK -> registered_agents.id

  test_id                 text not null      -- e.g. web_search.basic
  tool_name               text null
  required                boolean not null default true
  status                  text not null      -- pass | fail | warning | skipped
  latency_ms              int null

  error_code              text null
  error_message           text null
  request_preview_json    jsonb not null default '{}'::jsonb
  response_preview_json   jsonb not null default '{}'::jsonb

  started_at              timestamptz not null
  completed_at            timestamptz null
  created_at              timestamptz not null
```

## 5) `openclaw_handshake_tokens`

```
openclaw_handshake_tokens
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  token                   text unique not null
  expires_at              timestamptz not null
  used_at                 timestamptz null
  created_by              uuid null FK -> users.id
  created_at              timestamptz not null
```

## 6) `openclaw_integrations`

```
openclaw_integrations
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  plugin_instance_id      text not null
  integration_secret      text not null
  openclaw_workspace_id   text null
  plugin_version          text null
  status                  text not null   -- connected | disconnected
  connected_at            timestamptz not null
  last_seen_at            timestamptz not null
  metadata_json           jsonb not null
  created_at              timestamptz not null
  updated_at              timestamptz not null
```

## 7) `openclaw_remote_agents`

```
openclaw_remote_agents
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  integration_id          uuid FK -> openclaw_integrations.id
  remote_agent_id         text not null
  slug                    text not null
  display_name            text not null
  tools_json              jsonb not null
  constraints_json        jsonb not null
  is_active               bool not null
  last_synced_at          timestamptz not null
  created_at              timestamptz not null
```

## 8) `agent_usage_facts`

Denormalized profile history feed (fast pagination).

```
agent_usage_facts
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  agent_id                uuid FK -> registered_agents.id
  usage_type              text not null      -- run | workflow

  run_id                  uuid null FK -> runs.id
  workflow_id             uuid null FK -> graphs.id
  workflow_name_cache     text null
  run_status_cache        text null

  used_at                 timestamptz not null
  metadata_json           jsonb not null default '{}'::jsonb
  created_at              timestamptz not null
```

## 9) `agent_debug_refs`

Cross-link from Knotwork entities to provider-level IDs and trace handles.

```
agent_debug_refs
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  agent_id                uuid FK -> registered_agents.id

  run_id                  uuid null FK -> runs.id
  node_id                 text null
  openai_request_id       text null
  openai_response_id      text null
  openai_trace_id         text null
  anthropic_request_id    text null
  provider_project_hint   text null

  prompt_attempt_index    int null
  tool_call_count         int null
  created_at              timestamptz not null
```

## 10) `media_assets` (avatar storage metadata)

If not already present, add minimal shared media table for avatars.

```
media_assets
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  owner_user_id           uuid null FK -> users.id
  kind                    text not null      -- agent_avatar
  storage_key             text not null
  mime_type               text not null
  width                   int not null
  height                  int not null
  size_bytes              int not null
  checksum_sha256         text not null
  created_at              timestamptz not null
```

---

## Constraints and Check Rules

1. `registered_agents.provider` in (`openclaw`, `openai`, `anthropic`).
2. `registered_agents.status` in (`inactive`, `active`, `archived`).
3. `registered_agents.capability_freshness` in (`fresh`, `stale`, `needs_refresh`).
4. `registered_agents.preflight_status` in (`never_run`, `running`, `pass`, `warning`, `fail`).
5. For `provider='openclaw'`, endpoint is optional when plugin binding is used.
6. `agent_capability_snapshots.hash` unique per (`agent_id`, `hash`).
7. Exactly one baseline preflight per agent:
- partial unique index on `agent_preflight_runs(agent_id)` where `is_baseline=true`.
8. `agent_preflight_tests` unique per (`preflight_run_id`, `test_id`).

---

## Index Strategy

## `registered_agents`

1. `(workspace_id, status, updated_at desc)` for settings list.
2. `(workspace_id, provider, status)` for filters.
3. `(workspace_id, lower(display_name))` trigram/index for search.

## `agent_capability_snapshots`

1. `(agent_id, created_at desc)` for latest contract.
2. `(workspace_id, agent_id, hash)` unique for dedupe.

## `agent_preflight_runs`

1. `(agent_id, created_at desc)` for history tab.
2. `(workspace_id, status, created_at desc)` for ops monitor.

## `agent_preflight_tests`

1. `(preflight_run_id, required, status)` for fail summaries.
2. `(agent_id, test_id, created_at desc)` for trend charts.

## `agent_usage_facts`

1. `(agent_id, used_at desc)` for profile history timeline.
2. `(workspace_id, usage_type, used_at desc)` for analytics.

## `agent_debug_refs`

1. `(agent_id, created_at desc)` for profile debug panel.
2. `(run_id, created_at)` for run-detail back links.

---

## Retention and Data Lifecycle

1. `agent_capability_snapshots`: keep all for audit in dev; production recommendation keep 365 days then monthly rollup.
2. `agent_preflight_runs/tests`: keep 180 days raw; keep baseline snapshots indefinitely.
3. `agent_debug_refs`: keep 30–90 days configurable; sensitive provider IDs masked in non-owner contexts.
4. `media_assets` orphan cleanup: daily job deletes unreferenced assets older than 24h.

---

## Migration Plan (from current schema)

## Phase A: additive migration

1. Add new columns to `registered_agents`.
2. Create new tables (`agent_capability_snapshots`, `agent_preflight_runs`, `agent_preflight_tests`, `agent_usage_facts`, `agent_debug_refs`, optional `media_assets`).
3. Add indexes and check constraints.

## Phase B: backfill

1. Map `is_active=true` to `status='active'`, else `inactive`.
2. Map missing capability data to `capability_freshness='needs_refresh'`.
3. Map missing preflight to `preflight_status='never_run'`.
4. Create initial capability snapshot only when legacy records already have contract payload.

## Phase C: switch-over

1. API writes use new columns/tables.
2. Keep legacy columns readable.
3. Add compatibility view if needed for old endpoints.

## Phase D: cleanup (future)

1. Remove legacy columns after two release cycles.
2. Drop compatibility view and old code paths.

---

## Developer-mode Reset Semantics

For Session 8 testing, reset operation may hard-delete:
1. `runs`, `run_node_states`, `escalations`, `decision_events`, `agent_usage_facts`, `agent_debug_refs`.
2. workflows/channels if requested by explicit reset mode.

Reset should never delete:
1. workspace membership.
2. registered agent identities unless `--include-agents` flag is set.

---

## Mapping to API Contract

See [agents-settings-profile API contract](/Users/hieu/Work/crea8r/knotwork/docs/sysdesign/api/agents-settings-profile.md).

1. `/agents` list and detail read from `registered_agents`.
2. `/capabilities/*` uses `agent_capability_snapshots`.
3. `/preflight-runs*` uses `agent_preflight_runs` + `agent_preflight_tests`.
4. `/usage` uses `agent_usage_facts`.
5. `/debug-links` uses `agent_debug_refs`.
6. avatar upload/commit updates `media_assets` and `registered_agents.avatar_asset_id`.
## 11) `openclaw_execution_tasks`

```
openclaw_execution_tasks
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  integration_id          uuid FK -> openclaw_integrations.id
  run_id                  uuid FK -> runs.id
  node_id                 text not null
  agent_ref               text not null
  remote_agent_id         text not null
  system_prompt           text not null
  user_prompt             text not null
  session_token           text not null
  status                  text not null   -- pending | claimed | completed | escalated | failed
  claimed_at              timestamptz null
  completed_at            timestamptz null
  output_text             text null
  next_branch             text null
  escalation_question     text null
  escalation_options_json jsonb not null
  error_message           text null
  created_at              timestamptz not null
  updated_at              timestamptz not null
```

## 12) `openclaw_execution_events`

```
openclaw_execution_events
  id                      uuid PK
  workspace_id            uuid FK -> workspaces.id
  task_id                 uuid FK -> openclaw_execution_tasks.id
  event_type              text not null
  payload_json            jsonb not null
  created_at              timestamptz not null
```

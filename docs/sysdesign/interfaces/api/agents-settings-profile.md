# API Specification — S8 Agents (Settings + Profile)

> **Chat-first revision (latest):** preflight and capability trust flows are chat-native.
> - Preflight writes prompt/reply into agent main session chat.
> - Run detail reads persisted run chat session (`run_id`-scoped channel messages).
> - Handshake remains connectivity/auth, not sole capability truth source.

## Status

**Contract level:** Pre-implementation API contract for Session 8.

This document defines backend API behavior required by:
- `Settings > Agents` (onboarding + operations)
- `Agent Profile` (identity + capability + history + debug)

> <span style="color:#c1121f;font-weight:700">LEGACY</span>: Existing minimal agents CRUD is insufficient for S8 transparency requirements.

OpenClaw integration in S8 is **plugin-first**:
- workspace generates handshake token,
- OpenClaw plugin calls Knotwork handshake endpoint,
- Knotwork syncs remote OpenClaw agents,
- user registers a Knotwork agent from synced binding.

---

## Base Path and Envelope

Base path: `/api/v1/workspaces/:workspace_id`

Response envelope:

```json
{
  "data": {},
  "error": null
}
```

Error envelope:

```json
{
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "capability fetch failed",
    "details": {}
  }
}
```

---

## Authorization and Roles

1. `owner`
- full read/write on all endpoints.

2. `operator`
- read access to list/profile/history/debug.
- can run preflight.
- cannot archive/delete agent.
- activation/deactivation policy is workspace-configurable; default deny.

3. `viewer` (if enabled)
- read-only summary/profile.

---

## Canonical Enums

## Provider

- `openclaw`
- `openai` (<span style="color:#c1121f;font-weight:700">LEGACY / TRANSITIONAL</span>)
- `anthropic` (<span style="color:#c1121f;font-weight:700">LEGACY / TRANSITIONAL</span>)

## Agent status

- `inactive`
- `active`
- `archived`

## Preflight status

- `never_run`
- `running`
- `pass`
- `warning`
- `fail`

## Capability freshness

- `fresh`
- `stale`
- `needs_refresh`

---

## Resource Models

## Agent summary

```json
{
  "id": "uuid",
  "display_name": "Knotwork Researcher",
  "avatar_url": "https://...",
  "provider": "openclaw",
  "status": "active",
  "agent_ref": "openclaw:research-agent",
  "endpoint": "https://agent.example.com",
  "capability_version": "2026.03.01",
  "capability_hash": "sha256:...",
  "capability_refreshed_at": "2026-03-05T02:15:00Z",
  "capability_freshness": "fresh",
  "preflight_status": "pass",
  "preflight_run_at": "2026-03-05T02:16:30Z",
  "last_used_at": "2026-03-05T03:22:19Z",
  "created_at": "2026-03-04T10:00:00Z",
  "updated_at": "2026-03-05T03:22:19Z"
}
```

## Capability contract

```json
{
  "agent_id": "uuid",
  "version": "2026.03.01",
  "hash": "sha256:...",
  "refreshed_at": "2026-03-05T02:15:00Z",
  "tools": [
    {
      "name": "web_search",
      "description": "Search the web",
      "input_schema": {"type": "object"},
      "risk_class": "medium"
    }
  ],
  "constraints": {
    "network": "enabled",
    "search_providers": ["bing"],
    "file_system": "none",
    "max_tool_calls": 20,
    "max_runtime_seconds": 180
  },
  "policy_notes": [
    "Must perform web_search before escalation when request needs external facts"
  ],
  "raw": {}
}
```

## Preflight run summary

```json
{
  "id": "uuid",
  "agent_id": "uuid",
  "status": "pass",
  "required_pass_rate": 1,
  "pass_rate": 1,
  "median_latency_ms": 820,
  "failed_count": 0,
  "started_at": "2026-03-05T02:16:00Z",
  "completed_at": "2026-03-05T02:16:30Z",
  "is_baseline": true
}
```

---

## Endpoints

## 1) List agents (Settings table)

`GET /api/v1/workspaces/:workspace_id/agents`

Query params:
- `q` string (display name search)
- `provider` enum
- `status` enum
- `preflight_status` enum
- `cursor` string
- `limit` int (default 20, max 100)
- `sort` enum: `updated_at_desc` (default), `display_name_asc`, `last_used_desc`

Response:

```json
{
  "data": {
    "items": [],
    "next_cursor": null
  },
  "error": null
}
```

## 2) OpenClaw plugin handshake token

`POST /api/v1/workspaces/:workspace_id/openclaw/handshake-token`

## 3) Plugin callback handshake

`POST /openclaw-plugin/handshake`

Returns `integration_secret` used by plugin for runtime bridge calls.

## 4) List OpenClaw integrations

`GET /api/v1/workspaces/:workspace_id/openclaw/integrations`

## 5) List synced remote agents

`GET /api/v1/workspaces/:workspace_id/openclaw/integrations/:integration_id/agents`

## 6) Register Knotwork agent from synced remote agent

`POST /api/v1/workspaces/:workspace_id/openclaw/register-agent`

## 6.1) Plugin pulls pending execution task

`POST /openclaw-plugin/pull-task`

Header: `X-Knotwork-Integration-Secret: <integration_secret>`

Task payload follows Session Execution Contract input:
- `session_name` (target session key/name)
- `system_prompt`
- `user_prompt`
- agent identity fields (`agent_ref`, `remote_agent_id`)

The plugin must execute this task only via:
1. `create_session`
2. `send_message`
3. `sync_session`

## 6.2) Plugin submits execution event

`POST /openclaw-plugin/tasks/:task_id/event`

Header: `X-Knotwork-Integration-Secret: <integration_secret>`

Event types:
- `log`
- `completed`
- `escalation`
- `failed`

`completed` payload should be derived from `sync_session` output (assistant-visible message content).

## 7) Register legacy direct agent

`POST /api/v1/workspaces/:workspace_id/agents`

Request:

```json
{
  "display_name": "Knotwork Researcher",
  "provider": "openclaw",
  "agent_ref": "openclaw:research-agent",
  "endpoint": "https://agent.example.com",
  "credentials": {
    "type": "api_key",
    "api_key": "secret"
  },
  "activate_after_preflight": false
}
```

Behavior:
1. Creates `inactive` agent.
2. Does not auto-activate unless explicitly requested and preflight passes.
3. Stores only credential hint in response.

## 8) Get agent detail (profile header)

`GET /api/v1/workspaces/:workspace_id/agents/:agent_id`

Response includes agent summary + editable identity fields.

## 9) Update agent identity

`PATCH /api/v1/workspaces/:workspace_id/agents/:agent_id`

Request (partial):

```json
{
  "display_name": "Knotwork Researcher v2",
  "avatar_url": "https://..."
}
```

Notes:
- `provider`, `agent_ref`, and `endpoint` changes require re-validation flow (see endpoint 5).

## 10) Update connectivity config (revalidate required)

`PATCH /api/v1/workspaces/:workspace_id/agents/:agent_id/connectivity`

Request:

```json
{
  "endpoint": "https://new-agent.example.com",
  "credentials": {
    "type": "api_key",
    "api_key": "new-secret"
  }
}
```

Behavior:
1. Marks capability freshness `needs_refresh`.
2. Marks preflight status `never_run`.
3. Forces `inactive` until new preflight passes.

## 11) Activate agent

`POST /api/v1/workspaces/:workspace_id/agents/:agent_id/activate`

Request:

```json
{
  "allow_warning": false
}
```

Rules:
1. `pass` preflight required unless `allow_warning=true`.
2. Cannot activate when latest preflight is `fail`.

## 7) Deactivate agent

`POST /api/v1/workspaces/:workspace_id/agents/:agent_id/deactivate`

Request:

```json
{
  "reason": "maintenance"
}
```

## 8) Archive agent

`POST /api/v1/workspaces/:workspace_id/agents/:agent_id/archive`

Behavior:
1. Sets status `archived`.
2. Hidden from default workflow picker.
3. Existing workflow links remain historically valid.

## 9) Refresh capability contract

`POST /api/v1/workspaces/:workspace_id/agents/:agent_id/capabilities/refresh`

Request:

```json
{
  "save_snapshot": true
}
```

Response includes:
- latest capability contract,
- `changed` flag comparing previous hash,
- freshness status.

## 10) Get latest capability contract

`GET /api/v1/workspaces/:workspace_id/agents/:agent_id/capabilities/latest`

## 11) List capability snapshots

`GET /api/v1/workspaces/:workspace_id/agents/:agent_id/capabilities`

Query params:
- `cursor`, `limit`

## 12) Run preflight tests

`POST /api/v1/workspaces/:workspace_id/agents/:agent_id/preflight-runs`

Request:

```json
{
  "suite": "default",
  "include_optional": false
}
```

Response:

```json
{
  "data": {
    "preflight_run_id": "uuid",
    "status": "running"
  },
  "error": null
}
```

## 13) Get preflight run detail

`GET /api/v1/workspaces/:workspace_id/agents/:agent_id/preflight-runs/:preflight_run_id`

Response includes per-test rows:

```json
{
  "test_id": "web_search.basic",
  "tool_name": "web_search",
  "required": true,
  "status": "pass",
  "latency_ms": 430,
  "error": null,
  "request_preview": {},
  "response_preview": {}
}
```

## 14) List preflight history

`GET /api/v1/workspaces/:workspace_id/agents/:agent_id/preflight-runs`

## 15) Promote preflight baseline

`POST /api/v1/workspaces/:workspace_id/agents/:agent_id/preflight-runs/:preflight_run_id/promote-baseline`

## 16) Agent usage history (profile tab)

`GET /api/v1/workspaces/:workspace_id/agents/:agent_id/usage`

Query params:
- `cursor`, `limit`
- `type` enum: `all` (default), `workflows`, `runs`

Response:

```json
{
  "data": {
    "items": [
      {
        "type": "run",
        "run_id": "uuid",
        "workflow_id": "uuid",
        "workflow_name": "Market Research",
        "status": "completed",
        "timestamp": "2026-03-05T03:22:19Z"
      }
    ],
    "next_cursor": null
  },
  "error": null
}
```

## 17) Agent debug pointers (profile tab)

`GET /api/v1/workspaces/:workspace_id/agents/:agent_id/debug-links`

Response:

```json
{
  "data": {
    "recent_runs": [
      {
        "run_id": "uuid",
        "node_id": "node-1",
        "provider_request_id": "req_...",
        "provider_trace_id": "trace_...",
        "created_at": "2026-03-05T03:22:19Z"
      }
    ]
  },
  "error": null
}
```

## 18) Compatibility check for workflow step selection

`POST /api/v1/workspaces/:workspace_id/agents/:agent_id/compatibility-check`

Request:

```json
{
  "requirements": {
    "needs_web_search": true,
    "needs_file_write": false,
    "max_expected_runtime_seconds": 120,
    "required_tools": ["web_search"]
  }
}
```

Response:

```json
{
  "data": {
    "compatible": false,
    "warnings": [
      {
        "code": "MISSING_TOOL",
        "message": "Tool web_search not present in capability contract"
      }
    ],
    "missing_capabilities": ["tools.web_search"]
  },
  "error": null
}
```

## 19) Avatar upload contract (optional storage API)

Option A (direct URL allowed): client sends avatar URL via `PATCH /agents/:agent_id`.

Option B (preferred managed upload):
1. `POST /api/v1/workspaces/:workspace_id/agents/:agent_id/avatar/upload-url`
2. client uploads compressed/cropped image to signed URL
3. `POST /api/v1/workspaces/:workspace_id/agents/:agent_id/avatar/commit`

Commit request:

```json
{
  "upload_token": "...",
  "content_type": "image/webp",
  "width": 256,
  "height": 256,
  "size_bytes": 18342
}
```

---

## State Machine

## Agent status transitions

1. `inactive -> active`: activate endpoint, policy pass.
2. `active -> inactive`: deactivate endpoint.
3. `inactive -> archived`: archive endpoint.
4. `active -> archived`: requires deactivate first or implicit deactivate.

## Preflight transitions

1. `never_run -> running -> pass|warning|fail`
2. Any capability change sets `preflight_status=never_run`.
3. Failed required tests block activation.

## Capability transitions

1. refresh success updates `version/hash/refreshed_at`.
2. hash change flags baseline stale.

---

## Error Codes (minimum set)

- `AGENT_NOT_FOUND`
- `AGENT_ARCHIVED`
- `INVALID_PROVIDER`
- `CAPABILITY_FETCH_FAILED`
- `PREFLIGHT_FAILED`
- `PREFLIGHT_REQUIRED`
- `ACTIVATION_BLOCKED`
- `INSUFFICIENT_ROLE`
- `COMPATIBILITY_CHECK_FAILED`
- `RATE_LIMITED`

---

## Concurrency and Idempotency

1. `refresh` and `preflight` endpoints accept `Idempotency-Key` header.
2. Simultaneous refresh calls should return same in-flight job id.
3. Activate/deactivate must be compare-and-swap safe to avoid race toggles.

---

## Real-time Events (optional but recommended)

WebSocket or SSE topic payloads:

1. `agent.capability_refreshed`
2. `agent.preflight_started`
3. `agent.preflight_completed`
4. `agent.status_changed`

---

## Backward Compatibility

1. Keep existing `GET/POST/DELETE /agents` endpoints operational during migration.
2. Map old records into new summary model defaults:
- missing capability => `needs_refresh`
- missing preflight => `never_run`
3. Label non-OpenClaw providers as <span style="color:#c1121f;font-weight:700">LEGACY / TRANSITIONAL</span> in response metadata for UI badges.

See data model contract: [agents-settings-profile data model](/Users/hieu/Work/crea8r/knotwork/docs/sysdesign/data-models/agents-settings-profile.md).

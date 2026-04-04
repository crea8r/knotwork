# Session 12.1 — Unified Participant Model + Agent Bridge Design

**Status: ✅ Done**

## Goal

Unify human and agent identity into one participant model. One auth system, one onboarding path, one set of channels. Design the agent-bridge spec — the behavioral layer that tells agents how to be good Knotwork participants.

## Context

S12 proved the product works for humans. Now agents need to participate as equals. The prior architecture had three separate identity/auth systems (JWT for humans, integration_secret for OpenClaw, session_token for task execution), a special `agent_main` channel type, and `RegisteredAgent` as a separate table from `WorkspaceMember`. This separation is gone.

**Core principle:** a participant is a participant. Human or agent is a `kind` field used for settings display and transport-specific metadata, not a separate product surface. An agent onboards the same way a human does — gets credentials, joins channels, reads the same inbox/channel surfaces, and calls the same API/MCP endpoints. How it does its work is its own business.

**Agent discovery:** Both MCP (runtime tool discovery) and `skills.md` (narrative context + behavioral guidance). MCP tells agents what they CAN do. The agent-bridge spec tells them what they SHOULD do and WHEN.

---

## What Was Built

### 1. Unified participant model

`WorkspaceMember` is now the single identity table for all participants.

- `kind` field: `'human'` | `'agent'`
- `agent_config` JSON: provider-specific metadata for agent members
- Every agent has a `User` row (no email, has `public_key` instead)
- `RegisteredAgent` table: removed — migrated to `WorkspaceMember` rows with `kind='agent'`
- Participant IDs remain typed synthetic ids. Runtime behavior should treat both as normal members; the type exists for transport/routing and settings display, not as a separate product surface.

**Migration:** Alembic `0024_unified_participant_model` — existing `RegisteredAgent` rows became `WorkspaceMember kind=agent` rows. FK references updated.

### 2. One auth system — ed25519 challenge-response

Both humans and agents get JWT bearer tokens. The path to the token differs:

**Humans:** email → magic link → JWT (unchanged)

**Agents:** ed25519 public key + challenge-response:
1. Admin registers agent: `POST /api/v1/workspaces/{id}/members` with `{display_name, public_key, role}` — creates a `User` row (no email, stores base64url-encoded ed25519 public key) and a `WorkspaceMember(kind='agent')` row
2. Agent requests a nonce: `POST /api/v1/auth/agent-challenge` with `{public_key}` → `{nonce, expires_at}` (2-minute TTL, single-use)
3. Agent signs the nonce with its ed25519 private key: `signature = private_key.sign(nonce.encode())`
4. Agent redeems: `POST /api/v1/auth/agent-token` with `{public_key, nonce, signature}` → `{access_token}` (30-day JWT)
5. Agent uses `Authorization: Bearer <JWT>` on all subsequent calls — same as humans

**Why ed25519 over API keys:** Keys are never transmitted; only the public key is stored; nonces prevent replay attacks. An agent never sends its private key over the wire.

**New DB table:** `AgentAuthChallenge` — stores `{public_key, nonce, expires_at, used}`. Nonces expire in 2 minutes, single-use.

**New backend files:**
- `auth/models.py` — `AgentAuthChallenge` model added
- `auth/service.py` — `get_user_by_public_key()`, `create_agent_challenge()`, `verify_agent_challenge()`
- `auth/router.py` — `POST /auth/agent-challenge`, `POST /auth/agent-token`
- `workspaces/router.py` — `POST /{workspace_id}/members` (owner-only agent registration)
- `alembic/versions/0026_agent_auth_challenges.py`

### 3. Kill agent_main channel type

Removed entirely:
- `channel_type: "agent_main"` — gone from `ChannelCreate` schema
- `get_or_create_agent_main_channel()` — deleted from `channels/service.py`
- `list_channels` filter — `"agent_main"` removed
- Frontend hooks: `useAgentMainChatMessages`, `useAskAgentMainChat`, `useEnsureAgentMainChat` — deleted from `api/agents.ts`
- `AgentChatTab.tsx`, `AgentProfilePage.tsx` — deleted (all hooks were dead)
- Route `/agents/:agentId` — removed from `App.tsx`

No DM-style channels for any participant. Communication happens in shared channels.

### 4. Agent discovery: three endpoints

**`.well-known/agent` (unauthenticated)**
```
GET /api/v1/workspaces/{workspace_id}/.well-known/agent
```
Returns JSON: auth endpoints, key type, nonce TTL, token lifetime, skills endpoint URL, MCP server URL. An agent needs only `backend_url` + `workspace_id` to discover everything else. Modelled after OAuth's `/.well-known/openid-configuration`.

**`skills.md` (authenticated)**
```
GET /api/v1/workspaces/{workspace_id}/skills
```
Returns `text/markdown` — personalised to the calling participant (name + role embedded). Covers: workspace purpose, auth flow, MCP tool categories, handbook file list, active channels. Generated at request time from live workspace data.

**MCP resource**
`knotwork://workspace/skills` — same content as the REST endpoint, accessible via the MCP server. Agents can load it at startup via their MCP host.

**New backend files:**
- `workspaces/skills.py` — `generate_skills_md()` pure function
- `workspaces/skills_router.py` — `GET /{workspace_id}/skills` endpoint
- `workspaces/well_known_router.py` — `GET /{workspace_id}/.well-known/agent` endpoint
- `mcp/server.py` — `knotwork://workspace/skills` resource added

**Frontend:** Discovery URL shown in Settings → Members → "Add agent by public key" form with copy button. Operator gives this URL to the agent at setup time.

### 5. Agent-bridge spec

`agent-bridge/spec/` — behavioral protocol for all Knotwork participants:

```
agent-bridge/spec/
  README.md             — overview + folder map
  participant.md        — shared contract: channels, escalations, inbox, handbook, runs
  events.md             — 6 event types, payload schemas, ACK semantics
  priority.md           — non-preemptive task queue + dynamic scoring formula
  skills-template.md    — workspace context template
  human/
    auth.md             — magic link → JWT
    interface.md        — DecisionCard, inbox, channel mentions
  agent/
    auth.md             — ed25519 challenge-response flow
    protocol.md         — polling loop, session management, event handlers, error recovery
  plugin/openclaw/
    README.md           — placeholder for S12.2 rewrite
```

**Priority system** (`priority.md`) — the same scoring logic governs both the human UI and the agent bridge:
- Non-preemptive: current task runs to completion; full re-score before picking next
- `score = nature_weight + age_score + deadline_score + context_boost`
- `nature_weight`: task_assigned=80, mentioned_message=60, escalation_created=50, run_failed=20, run_completed=10, message_posted=10
- `age_score`: `min(40, 10 × log₂(age_minutes + 1))` — plateaus at 64 min to prevent stale events burying fresh ones
- `deadline_score` (0–60): explicit timeout or synthetic deadline from **channel rhythm** (median inter-message gap, clamped [5 min, 4 h]; empty channel = 15 min)
- `context_boost`: in-memory run +10, open channel session +5, workspace owner sender +5
- **Obligation promotion**: a `message_posted` (weight=10) promotes to weight=55 when all three hold: unanswered question + in-domain + response gap elapsed since channel rhythm window opened

### 6. Credential lifecycle

| Phase | What happens |
|---|---|
| Registration | Owner adds agent in Settings → Members with display name + ed25519 public key + role |
| Authentication | Agent requests nonce → signs → receives 30-day JWT |
| Steady state | Agent uses JWT on all API/MCP calls; refreshes before expiry |
| Renewal | Agent re-runs challenge-response before JWT expires (or after 401) |
| Revocation | Not yet implemented — planned for S12.3 (deactivate member → invalidate JWT) |
| Audit | Challenge/token events flow through standard DB audit trail |

Key rotation = admin removes old `User.public_key` and re-registers agent with new public key.

### 7. Notification contract

Six event types defined in `agent-bridge/spec/events.md`:

| Event type | Nature weight | Delivery semantics |
|---|---|---|
| `task_assigned` | 80 | ACK required; at-least-once |
| `mentioned_message` | 60 | ACK required; at-least-once |
| `escalation_created` | 50 | Best-effort |
| `run_failed` | 20 | Best-effort |
| `run_completed` | 10 | Best-effort |
| `message_posted` | 10 (or 55 if obligation) | Best-effort |

Delivery: inbox polling (`GET /api/v1/workspaces/{id}/inbox?unread=true`). Mark read via `PATCH /inbox/deliveries/{id}` or bulk `POST /inbox/read-all`.

The important boundary is:
- Knotwork exposes participant-scoped inbox/events/preferences through normal API/MCP surfaces.
- Any plugin or bridge is agent-side only. Knotwork does not contain a plugin-specific dispatch subsystem.
- Human and agent members should see the same product behavior outside settings/admin UX; differences are transport capabilities, not separate interaction models.

---

## Settings UI

Settings → Members tab updated:
- Kind filter pills (all / human / agent)
- Members table shows Kind column with badges
- Agent accounts display "agent account" (italic) instead of email
- Two invite modes: "Invite by email" (existing) and "Add agent by public key" (new)
- "Add agent by public key" form shows discovery URL prominently with copy button — operator gives this URL to the agent at setup time

---

## Acceptance Criteria — Final State

1. ✅ One participant model: `WorkspaceMember` with `kind` field. No separate `RegisteredAgent` table for identity.
2. ✅ Agents authenticate via ed25519 challenge-response → JWT on the same endpoints as humans. No API keys stored.
3. ✅ `agent_main` channel type is gone. No DM-style channels for any participant.
4. ✅ `skills.md` generated from live workspace data (knowledge files + channels) and served as both REST endpoint and MCP resource.
5. ✅ `agent-bridge/spec/` exists with behavioral protocol covering notification rhythm (channel rhythm + obligation model), task priority scoring, session management, event handling, and state management.
6. ✅ Notification contract specifies 6 event types, payload schemas, delivery semantics, and ACK requirements.
7. ✅ Credential lifecycle defined and implemented: registration → ed25519 key → challenge-response → 30-day JWT → renewal. Discovery endpoint gives agents everything they need from just `backend_url + workspace_id`.

---

## Out of Scope (deferred)

- Building the bridge software / OpenClaw plugin rewrite (→ S12.2)
- Agent Zero, representatives (→ S12.3)
- Workload honesty (→ S12.3)
- JWT revocation / member deactivation (→ S12.3)
- Transport upgrade (WebSocket vs polling) — bridge decides per-implementation

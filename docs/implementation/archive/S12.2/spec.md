# Session 12.2 — Agent Bridge Layer

## Goal

Build the workspace guide system, finalize the agent onboarding surface, and rewrite the OpenClaw plugin into an agent-side bridge that consumes Knotwork's normal participant surfaces. The plugin remains the reference implementation for how any agent connects to a Knotwork workspace.

S12.2 depends on S12.1 (unified participant model + ed25519 auth).

Related extension:
- `channel-action-extension.md` — channel-first discussion model for asset chat and structured change actions

## Context

S12.1 produces:
- A unified `WorkspaceMember` model with `kind` field (human/agent)
- ed25519 challenge-response → 30-day JWT for agents on the same endpoints as humans
- `/.well-known/agent` discovery endpoint
- `GET /workspaces/{id}/skills` — auto-generated context document
- `POST /auth/agent-challenge` + `POST /auth/agent-token` — already implemented

S12.2 builds on that foundation. The three deliverables are:

1. **Workspace guide** — a human-authored Markdown document on the workspace that defines how participants (human and agent) should behave. Agents fetch it at startup and poll for updates. It replaces the hardcoded behavioral principles in `skills.py`.
2. **Agent onboarding surface** — the "Add Agent" form in Settings already shows the `.well-known/agent` URL. S12.2 makes that surface complete and fixes confusing copy.
3. **OpenClaw plugin rewrite** — swap the task source from Knotwork's old pull-task queue to the inbox API. Auth migrates from `integration_secret` to ed25519 challenge-response. The execution model (task pile, concurrency, `subagent.run()`) is unchanged.

**Core principle:** Knotwork builds the member/inbox/API/MCP surface. The plugin owns agent-side polling, concurrency, and execution. There is no Knotwork-side plugin dispatch layer and no special plugin runtime contract beyond the normal participant APIs.

## In Scope

### 1. Workspace guide

**What it is:** A Markdown document stored per workspace. Think "company rulebook for all participants." Both humans and agents read it. The owner edits it in Settings → Guide.

**Data model:**
```
Workspace
  guide_md:      text | None     ← Markdown content, nullable (empty = no guide yet)
  guide_version: int              ← increments on every save, starts at 0
```

**Backend:**
- Migration `0028_workspace_guide.py` — add two columns
- `GET /api/v1/workspaces/{id}/guide` → `{ guide_md, guide_version }` (any member)
- `PUT /api/v1/workspaces/{id}/guide` → update guide, increment version (owner only)
- Update `skills.py`: embed `workspace.guide_md` in the skills document in place of the hardcoded `## Behavioral principles` section

**Agent polling:**
- Agents fetch guide at startup
- Periodically (every poll cycle): `GET /guide` and compare `guide_version` against cached value
- On version change → reload guide into context

### 2. Agent onboarding surface

Two paths to joining a workspace as an agent:

**Admin-initiated:** Admin enters display name + public key in Settings → Members → Add Agent. The form already shows the `.well-known/agent` URL via `DiscoveryPrompt`. Fix the post-add success message (currently says "Share the public key with the agent" — wrong; the agent already has their own key). Should direct the admin to share the discovery URL.

**Agent-owner-initiated:** The agent owner only needs two pieces of information from the admin: the backend URL and workspace ID. They can self-discover everything else from `/.well-known/agent`.

**Onboarding steps the agent follows:**
1. Generate an ed25519 keypair (if not already done)
2. Install the OpenClaw plugin (or any compatible bridge)
3. Give the public key to the workspace admin (out-of-band)
4. Once admin adds the public key: configure the plugin with `KNOTWORK_URL` + `WORKSPACE_ID` + `PRIVATE_KEY_PATH`
5. Plugin calls `/.well-known/agent` to discover auth endpoints
6. Plugin authenticates via challenge-response → receives JWT
7. Plugin fetches `GET /skills` → loads workspace context
8. Plugin fetches `GET /guide` → loads workspace behavioral guide
9. Plugin starts polling inbox

### 3. OpenClaw plugin rewrite

**Principle:** The plugin's task execution model is agent-side and stays agent-side. What changes is the task *source*.

```
Old:  poll Knotwork task queue (/openclaw/tasks/pull) → claim task → subagent.run()
New:  poll inbox (/inbox?unread=true)                 → enqueue participant event → subagent.run()
```

Each inbox event becomes a task on the plugin's internal pile. Concurrency limits, task lifecycle, and `subagent.run()` are unchanged. The plugin fetches and caches the workspace guide at startup and re-fetches when `guide_version` changes. Knotwork itself remains agnostic about plugin execution mechanics; it only exposes participant-scoped inbox/events/preferences through the normal API.

**File changes (minimal diff):**

| File | Change |
|---|---|
| `handshake.ts` → **`auth.ts`** | Rename. Swap `integration_secret` handshake for ed25519 challenge-response (POST `/auth/agent-challenge` → sign → POST `/auth/agent-token`). Auto-renew when JWT is within 24h of expiry or on 401. |
| `bridge.ts` | Remove `pullTask()`. Add `pollInbox()` → calls `GET /inbox?unread=true`, returns events. Add `fetchGuide()` → calls `GET /guide`, returns `{ guide_md, guide_version }`. |
| `worker.ts` | Feed task pile from `pollInbox()` instead of claim loop. Map each inbox event to an internal task (type, payload, event_id for dedup). Execution via `subagent.run()` unchanged. |
| `plugin.ts` | Update startup: call `auth.ts` flow → load skills (`GET /skills`) → load guide (`GET /guide`) → start polling. Periodic guide version check: if `guide_version` changed, reload. |
| `rpc.ts` | Rename `knotwork.reconnect` → `knotwork.reset_connection`. |

**Keep unchanged:** concurrency slots, task state, backoff/retry logic, `knotwork.status` RPC, `knotwork.logs` RPC, config storage, gateway RPC registration pattern.

## Explicitly Out of Scope

- Unified participant model (done in S12.1)
- `/.well-known/agent` discovery endpoint (done in S12.1)
- `POST /auth/agent-challenge` + `POST /auth/agent-token` (done in S12.1)
- `GET /workspaces/{id}/skills` endpoint (done in S12.1)
- Agent Zero, representatives (→ S12.3)
- Workload honesty (→ S12.3)
- A "bridge library" in the Knotwork repo — the plugin owns polling/execution
- Non-OpenClaw bridge implementations (future)

## Boundary Clarification

- Knotwork treats human and agent members as the same product actor outside settings/admin presentation.
- Transport differences live at the edge: email, app inbox, or push (agent bridge polling, mobile, etc.).
- The bridge is not a special Knotwork subsystem. It is one possible client runtime that reads the same participant inbox/events and calls the same API/MCP surfaces as any other client.
- Delivery means are `app`, `email`, and `push`. `push` means "client-side pull at client-chosen intervals" — Knotwork records a `push` delivery row (status=skipped) as an intent marker; the bridge polls `GET /inbox` for unread app-delivery events and ACKs via PATCH after handling.

## Key Files

**Backend — new:**
- `backend/alembic/versions/0028_workspace_guide.py`

**Backend — modify:**
- `backend/knotwork/workspaces/models.py` — add `guide_md`, `guide_version`
- `backend/knotwork/workspaces/router.py` — add `GET/PUT /{id}/guide`
- `backend/knotwork/workspaces/skills.py` — embed guide content, remove hardcoded principles

**Frontend — new:**
- `frontend/src/components/settings/GuideTab.tsx`
- Frontend API hook — `useWorkspaceGuide`, `useUpdateWorkspaceGuide`

**Frontend — modify:**
- `frontend/src/pages/SettingsPage.tsx` — add "Guide" tab
- `frontend/src/components/settings/MembersTab.tsx` — fix post-add-agent success message

**Plugin — modify:**
- `plugins/openclaw/src/lifecycle/handshake.ts` → renamed to `auth.ts`
- `plugins/openclaw/src/openclaw/bridge.ts`
- `plugins/openclaw/src/lifecycle/worker.ts`
- `plugins/openclaw/src/plugin.ts`
- `plugins/openclaw/src/lifecycle/rpc.ts`

## Acceptance Criteria

1. `Workspace` has `guide_md` (text, nullable) and `guide_version` (int, default 0).
2. `GET /workspaces/{id}/guide` returns `{ guide_md, guide_version }` for any member.
3. `PUT /workspaces/{id}/guide` updates the guide and increments `guide_version` (owner only).
4. `GET /workspaces/{id}/skills` embeds `guide_md` content instead of hardcoded behavioral principles.
5. Settings → Guide tab lets the owner edit the workspace guide.
6. MembersTab post-add-agent message directs admin to share the discovery URL, not the public key.
7. OpenClaw plugin authenticates via ed25519 challenge-response (not `integration_secret`).
8. Plugin polls `/inbox?unread=true` for tasks; each event flows through existing `subagent.run()` execution path.
9. Plugin fetches guide at startup and re-fetches when `guide_version` changes.
10. All prior session tests still pass.

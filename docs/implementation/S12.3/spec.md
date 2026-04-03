# Session 12.3 — Agent Zero, Representatives, and Workload Honesty

## Goal

With the unified participant model (S12.1) and working bridge layer (S12.2), introduce the agent features that sit on top. Agent Zero, workspace representatives, and workload honesty are configuration on a solid foundation — not architecture.

S12.3 depends on S12.2 (working bridge layer). It can begin design work in parallel with S12.2 but should not ship until agents can actually connect via the bridge.

## Context

The foundation is now:
- **S12.1:** One `WorkspaceMember` table with `kind` field. JWT-based auth for both humans and agents, with ed25519 challenge-response for agent login. `skills.md`. Agent-bridge behavioral spec.
- **S12.2:** Working bridge software. OpenClaw plugin rewritten as bridge implementation. Agents can connect, receive notifications, and call Knotwork API.

S12.3 adds the workspace-level features that make agents useful team members: Agent Zero as orchestrator, representatives as accountability model, and workload honesty as operational visibility.

## In Scope

### 1. Agent Zero

Agent Zero is a WorkspaceMember with `kind=agent` and a special role: `orchestrator`. It is the workspace's optional generalist intelligence. See `docs/sysdesign/concepts/agent-zero.md` for the full concept.

- Add `role` field to WorkspaceMember agent config JSON (`specialist` | `orchestrator`, default: `specialist`)
- Only one orchestrator per workspace (UI enforces)
- Guided onboarding conversation (re-runnable):
  - Understand the work -> create starter workflows
  - Create starter Handbook content
  - Create first project
  - Invite team members
  - Recruit specialist agents
- Workspace-wide read access for ongoing monitoring:
  - Stalled runs (paused beyond threshold)
  - Project health (deadlines vs. incomplete objectives)
  - Escalation backlog
  - Agent utilization (success vs. escalation rates)
- Primary representative designation (`is_primary: true`)

Agent Zero connects via the bridge (S12.2). It uses the same notification polling, session management, and API access as any other agent participant. The "orchestrator" role grants broader read permissions, not a different connection mechanism.

### 2. Workspace representatives

Representatives are the workspace members (human or agent) designated as in charge of the workspace's interactions. See `docs/sysdesign/concepts/representatives.md`.

**Data model:**
```
WorkspaceRepresentative
  id                uuid  PK
  workspace_id      uuid  FK -> Workspace
  member_id         uuid  FK -> WorkspaceMember
  is_primary        bool
  created_at        timestamptz
```

Note: `member_id` references the unified `WorkspaceMember` table (from S12.1). Both human and agent representatives use the same FK — no separate `agent_id` column needed.

- Human + agent representatives coexist
- Representative-priority routing: events route to primary first, then others
- CRUD endpoints: `GET/POST/DELETE /api/v1/workspaces/:id/representatives`
- Agent Zero is the canonical primary representative when it exists

**What representatives do:**
- Receive Knotwork internal events via their configured delivery means
- Handle external interactions using their own tools
- Call Knotwork MCP/API when structured work is needed
- Knotwork does not manage how they communicate externally

### 3. Workload honesty

Queue state must be visible and honest — not hidden behind generic "pending."

**Queue states:**
- `unclaimed` — task created, no participant has picked it up
- `queued` — assigned to a participant but not yet started
- `running` — actively being worked
- `stalled` — started but heartbeat/progress gone quiet (configurable threshold)
- `orphaned` — participant disconnected, task left in limbo

**Assignment semantics anchored to participants (not plugins):**
- Tasks are assigned to workspace members (human or agent), not to plugins or bridge instances
- Participant capacity is self-reported (via heartbeat from bridge, or manual status from human)
- Knotwork does not manage execution — it tracks what participants claim and report

**Operator UI:**
- Status buckets with badges in dashboard
- Task state labels in run detail with context
- Cancel button for unclaimed/queued tasks
- Queue depth warning on run trigger

**Historical input:** `workload-honesty-spec.md` and `workload-honesty-plan.md` are preserved in this directory as design input. They reflect pre-MCP assumptions and should not be implemented as written — the problem statements remain valid but the solutions need fresh design anchored to the unified participant model from S12.1.

### 4. Design questions

These questions carry forward from earlier planning:

- **Identity/permission model for agent participants.** What can an agent see and do in the workspace? Read-only by default? Scoped to assigned projects? The orchestrator role (Agent Zero) gets broader permissions — what does "broader" mean precisely?
- **Transcript visibility and audit.** When an agent resolves an escalation or posts to a channel, how is authorship recorded? What audit trail is required? The unified `WorkspaceMember` model should make this cleaner — participant identity is always tied back to a workspace member, even though the typed participant id may still encode transport/routing information.
- **Workload-honesty placement.** Where do queue semantics live now that execution is agent-side? In the Knotwork backend (state machine tracking claims and heartbeats), in the agent's self-reporting (via bridge heartbeat), or both?

## Explicitly Out of Scope

- Unified participant model (done in S12.1)
- Bridge software and plugin rewrite (done in S12.2)
- Designer/workflow chat agent participation (beyond Phase 1)
- Handbook mention syntax (`/filename`, `[[filename]]`) (beyond Phase 1)
- Project-level AI status writing (beyond Phase 1)

## Key Files

**Backend — new:**
- `workspaces/representatives.py` — WorkspaceRepresentative model + service
- `workspaces/router_representatives.py` — CRUD endpoints
- Migration: add `WorkspaceRepresentative` table

**Backend — modify:**
- `workspaces/models.py` — add `role` to agent config in WorkspaceMember
- `notifications/service.py` — representative-priority routing
- `runs/service.py` — workload state tracking (unclaimed/queued/running/stalled/orphaned)

**Frontend — new/modify:**
- Settings -> Representatives tab
- Agent Zero onboarding flow UI
- Dashboard workload status buckets
- Run detail task state labels

## Acceptance Criteria

1. Agent Zero is a registerable orchestrator (`role: orchestrator` in WorkspaceMember config) with guided onboarding flow.
2. Representatives model supports human + agent designation with priority routing, using unified `WorkspaceMember` FK.
3. Workload state is visible to operators with honest queue semantics (unclaimed/queued/running/stalled/orphaned).
4. Agent Zero connects via the same bridge mechanism as any other agent (S12.2) — no special connection path.
5. Identity, permission, and audit semantics for agent participants are documented.
6. Historical workload-honesty material has been reviewed and solutions redesigned for the unified participant model.

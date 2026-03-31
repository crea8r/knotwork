# Session 12.2 — Agent Zero, Representatives, and Workload Honesty

## Goal

With the plugin boundary defined in S12.1, introduce the agent features that sit on top of it. Agent Zero, workspace representatives, and workload honesty are configuration on a clear boundary — not architecture.

S12.2 can run in parallel with S12.3 (OpenClaw plugin redesign). Both depend only on S12.1's boundary being defined.

## In Scope

### 1. Agent Zero

Agent Zero is a RegisteredAgent with `role: "orchestrator"` — the workspace's optional generalist intelligence. See `docs/sysdesign/concepts/agent-zero.md` for the full concept.

- Add `role` enum field to RegisteredAgent (`specialist` | `orchestrator`, default: `specialist`)
- Only one orchestrator per workspace (UI enforces)
- Guided onboarding conversation (re-runnable):
  - Understand the work → create starter workflows
  - Create starter Handbook content
  - Create first project
  - Invite team members
  - Recruit specialist agents
- Workspace-wide read access for ongoing monitoring:
  - Stalled tasks (blocked beyond threshold)
  - Project health (deadlines vs. incomplete objectives)
  - Escalation backlog
  - Agent utilization (success vs. escalation rates)
- Primary representative designation (`is_primary: true`)

### 2. Workspace representatives

`WorkspaceRepresentative` — the model for who is in charge of a workspace's interactions.

```
WorkspaceRepresentative
  id                uuid  PK
  workspace_id      uuid  FK → Workspace
  member_id         uuid  FK → WorkspaceMember  nullable
  agent_id          uuid  FK → RegisteredAgent  nullable
  is_primary        bool
  created_at        timestamptz
```

- Human + agent representatives coexist
- Representative-priority routing: events route to primary first, then others
- CRUD endpoints: `GET/POST/DELETE /api/v1/workspaces/:id/representatives`
- Agent Zero is the canonical primary representative when it exists

### 3. Workload honesty

Queue state must be visible and honest — not hidden behind generic "pending."

**Queue states:**
- `unclaimed` — task created, no agent/human has picked it up
- `queued` — assigned to a representative but not yet started
- `running` — actively being worked
- `stalled` — started but heartbeat/progress gone quiet (configurable threshold)
- `orphaned` — representative disconnected, task left in limbo

**Task assignment semantics anchored to representatives:**
- Tasks are assigned to representatives, not to plugins
- Representative capacity is self-reported (via heartbeat or status update)
- Knotwork does not manage agent execution — it only tracks what representatives claim and report

**Operator UI:**
- Status buckets with badges in dashboard
- Task state labels in run detail with context
- Cancel button for unclaimed/queued tasks
- Queue depth warning on run trigger

**Historical input:** `workload-honesty-spec.md` and `workload-honesty-plan.md` are preserved in this directory as design input. They reflect pre-MCP assumptions and should not be implemented as written — the problem statements remain valid but the solutions need fresh design anchored to S12.1's boundary.

### 4. Design questions (carried from old S12.2)

These questions from the original S12.2 remain relevant:

- **Identity/permission model for agent participants.** What can an agent see and do in the workspace? Read-only by default? Scoped to assigned projects?
- **Transcript visibility and audit.** When an agent resolves an escalation or posts to a channel, how is authorship recorded? What audit trail is required?
- **Workload-honesty placement.** Where do queue semantics live now that the plugin is not an execution layer? In the Knotwork backend (state machine), in the representative's self-reporting, or both?

## Explicitly Out of Scope

- Designer/workflow chat agent participation (beyond Phase 1)
- Handbook mention syntax (`/filename`, `[[filename]]`) (beyond Phase 1)
- Project-level AI status writing (beyond Phase 1)
- Project progress summaries as product features (beyond Phase 1)
- Plugin transport or implementation details (→ S12.3)

## Acceptance Criteria

1. Agent Zero is a registerable orchestrator with guided onboarding flow.
2. Representatives model supports human + agent designation with priority routing.
3. Workload state is visible to operators with honest queue semantics (not hidden behind generic status values).
4. Configuration sits cleanly on S12.1 boundary — no execution assumptions leak into the plugin.
5. Identity, permission, and audit semantics for agent participants are documented.

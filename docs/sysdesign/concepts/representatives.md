# Core Concepts — Workspace Representatives

Added in S12. Representatives are how Knotwork models accountability for external interactions while keeping a clean boundary between Knotwork-managed internal delivery and representative-managed external communication.

---

## The Model

A **Representative** is a WorkspaceMember or RegisteredAgent designated as in charge of the workspace's external interactions. Multiple representatives are supported.

```
Workspace
  └─ Representatives[]
       ├─ Agent Zero  (RegisteredAgent, role: orchestrator, via OpenClaw)  is_primary: true
       └─ Sarah Chen  (WorkspaceMember, human)                             is_primary: false
```

**Agent Zero** is the canonical primary representative when it exists — the workspace's orchestrator agent, created optionally during post-install onboarding. See [concepts/agent-zero.md](./agent-zero.md).

Representatives are a workspace-level designation — not tied to a specific channel, project, or workflow. They are the people and agents the workspace puts in charge.

---

## What Knotwork Does with Representatives

1. **Routes internal events and task assignments** to representatives (in priority order: primary first, then others) via their configured communication means
2. **Surfaces task completions** to representatives rather than broadcasting to all workspace members
3. **Does not manage** how representatives communicate externally — that remains entirely their concern

Knotwork's delivery system can send internal events or assignments through configured means such as app, email, or OpenClaw plugin. This is separate from the representative's own external tools.

---

## What Representatives Do

Representatives handle external interactions using their own tools. Knotwork does not run their customer/vendor communication workflow for them.

**When structured work is needed**, a representative calls Knotwork via MCP or REST API:

```
Representative reads email → decides "I need a contract review run"
  → calls Knotwork MCP: create_task(project_id, "Review Acme contract", graph_id=..., input=...)
  → Knotwork executes the Run
  → representative calls: get_task_output(task_id)
  → representative sends reply using their own email client
```

**MCP tools available to representatives (S12+):**

| Tool | Purpose |
|---|---|
| `list_projects()` | List workspace projects with status |
| `create_project(objective, deadline)` | Start a new project |
| `list_tasks(project_id)` | List tasks in a project |
| `create_task(project_id, description, graph_id?, input?)` | Create a task, optionally triggering a Run |
| `get_task_output(task_id)` | Retrieve the output of a completed task |
| `update_task_status(task_id, status)` | Mark a task blocked, done, etc. |
| `add_project_document(project_id, title, content)` | Add context to the project room |
| `get_project_status(project_id)` | Quantitative + qualitative project summary |

These extend the existing MCP toolset (S7 graph/run tools remain available).

---

## Human vs. Agent Representatives

Both humans and agents can be representatives. The designation is what matters — not what's behind it.

- **Human representative**: a WorkspaceMember who receives Knotwork events over app/email, checks their own external tools, and calls the MCP/API when work needs running
- **Agent representative**: a RegisteredAgent (e.g., connected via OpenClaw) that can receive Knotwork task delivery over plugin, use its own external tools, decide when to trigger Knotwork tasks, and handle outputs or replies

From the workspace's perspective, both are representatives. From external parties' perspective, they interact with whoever the representative is — a person, an agent, or a human supervised by an agent. The distinction is internal.

---

## S12 Separation of Concerns

S9.2 introduces participant-specific event delivery and treats OpenClaw plugin as one Knotwork-managed communication mean for internal routing.

S12 makes the boundary explicit:

- **OpenClaw plugin**: Knotwork -> agent delivery path
- **MCP**: agent -> Knotwork interaction surface

This separation avoids overloading the plugin with long-term application semantics while preserving compatibility with the delivery model introduced earlier.

---

## The Broader Vision

The representative model reflects how organizations actually work: you put someone in charge of external relations. You don't micromanage how they communicate — you trust them to handle it and call you when they need the organization's resources (which, in Knotwork's case, means running a workflow, loading knowledge, or triggering an escalation).

A workspace IS a digital organization. Its team is its members and agents. Representatives are the external-facing members of that team. Knotwork is the organizational backbone they call into when structured work needs executing.

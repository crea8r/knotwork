# Core Concepts — Workflow

## Graph

A **Graph** is a workflow. It defines a set of nodes and the edges connecting them. A graph represents a business process — a contract review pipeline, a customer support flow, a research-to-publish pipeline.

A graph has:
- A name and description
- A set of nodes
- A set of edges (connections between nodes)
- A trigger configuration (manual, API, scheduled)
- An optional input schema (JSON Schema for the run trigger form)
- An owner and access roles

A graph is designed once and run many times. Each execution is a **Run**.

---

## Project

A **Project** is an objective-scoped work container. It is the thing humans actually care about — not the workflow template (Graph), but the specific pursuit: "Q2 enterprise onboarding push", "Hotel contract review for Acme".

A project has:
- An **objective** (text) — what success looks like
- A **deadline** and **status** (open / in-progress / blocked / done)
- A **dashboard** — quantitative progress (task completion %, run success rate) and qualitative assessment (S11+)
- A set of **Tasks**
- A **Project Document store** — project-scoped context (see ProjectDocument below)

A project is not a Graph. A Graph is a reusable process template; a Project is a specific pursuit that uses many Graph instances across its Tasks.

---

## Task

A **Task** is the user-facing work atom within a Project. Tasks are what humans track and manage day-to-day.

A task has:
- A name, description, and status (open / in-progress / blocked / done)
- A **Channel** (task chat) — the communication surface for this task
- Zero or more linked **Runs** — a task may trigger one or more graph executions

Tasks without any agent connected are human-executed: the task is assigned to a person who does the work manually and updates the status. Tasks with an agent connected can trigger a Run against a Graph and receive the output automatically.

The task is the user-facing atom. The Run is the execution detail.

---

## ProjectDocument

A **ProjectDocument** is the third knowledge layer. It lives at the Project scope — neither workspace-wide (like the Handbook) nor ephemeral per-run (like Run Context).

Project documents are the "project room" — the accumulated understanding of this specific pursuit: briefs, competitive analysis, decision logs, stakeholder notes, research. Any agent working on any task in the project loads them automatically.

**Three knowledge layers in every agent run:**

| Layer | Scope | Purpose |
|---|---|---|
| **Handbook** | Workspace | How to work — SOPs, reusable guidelines |
| **Project Documents** | Project | What this project is about — brief, decisions, research |
| **Run Context** | Run | What you're working on right now — this task's specific input |

ProjectDocuments use the same StorageAdapter pattern as the Handbook, scoped to the Project.

---

## Channel

A **Channel** is the primary collaboration surface in Knotwork. Channels are flat (not nested) and exist in five scopes:

- **Workspace bulletin** (S12+) — one per workspace. A shared board where any member (human or agent) can post workspace-wide updates, announcements, and status. Reduces the need for external chat tools for internal coordination.
- **Project chat** (S10+) — one per project. A shared room open to all workspace members for project-level discussion alongside the focused per-task channels.
- **Task-linked channel** (S10+) — the chat for a specific Task. Runs, escalations, and task updates appear as thread events here.
- **Workflow-linked channel** — linked to a graph for design consultation and structured execution.
- **Resource-linked channel** — attached to a handbook resource for collaborative editing and proposal discussion.

Channels across all scopes share the same structure: immutable message history, explicit decision events, and thread-first display. The scope determines what events automatically appear in the thread.

In Phase 1, all channels are accessible to all workspace members — no per-channel access restriction. **Phase 2** introduces permission scoping: fine-grained control over who can read or post in each channel.

---

## Node

A **Node** is a single step in a graph. Every node has a type that determines how it executes.

All nodes share a common set of properties:
- **Name** — human-readable label shown on the canvas
- **Knowledge** — one or more linked handbook fragments loaded at runtime
- **Input sources** — which prior node outputs and run input this node receives
- **Note** — optional designer annotation (visible on canvas, not used in execution)

### Node Types

| Type | What it does |
|------|-------------|
| **Agent** | Delegates execution to a registered agent (`agent_ref`). Handles all reasoning, human gating, and tool use. `agent_ref` can be an Anthropic model, OpenAI model, or `"human"`. |
| **Conditional Router** | <span style="color:#c1121f;font-weight:700">LEGACY</span> node type. In current runtime it executes through the unified agent pipeline and selects route via `next_branch`. |
| **Start** | Required entry point. Every graph must have exactly one. |
| **End** | Required exit point. Every graph must have at least one. |
| **Sub-graph** *(Phase 2)* | Invokes another graph and waits for its result. |

> **Note:** <span style="color:#c1121f;font-weight:700">LEGACY</span> node types `llm_agent` and `human_checkpoint` are supported via backward-compatible
> fallbacks but should be migrated to the unified `agent` type. `tool_executor` nodes raise a
> `RuntimeError` and must be replaced with `agent` nodes.

---

## Edge

An **Edge** connects two nodes. There are two kinds:

- **Direct edge** — always taken when the source node completes
- **Conditional edge** — taken only when a condition evaluates to true (used after Conditional Router nodes)

A node can have multiple outgoing edges. When parallel edges exist, both target nodes execute simultaneously.

---

## Knowledge Fragment

A **Knowledge Fragment** is a markdown file in the workspace knowledge base. It is the unit of knowledge in Knotwork.

A fragment contains how your team works: instructions, guidelines, do's and don'ts, examples, domain rules, red flags, checklists, templates. It is prescriptive and reusable — not case-specific.

Fragments are:
- **Stored as `.md` files** in a file/folder structure familiar to anyone who has used a note-taking app
- **Linked** to other fragments using `[[wiki-style links]]`
- **Domain-scoped** by folder — the folder a file lives in determines which other nodes' traversals will include it
- **Versioned** automatically — every save creates a new version; old versions are never deleted
- **Shared** across multiple nodes and graphs — one fragment can serve many workflows
- **Owned** by a person or team — different employees maintain different fragments

A node references one or more fragments. At run time, the agent loads the full resolved tree of all referenced fragments, filtered by domain.

See [knowledge/linking.md](../knowledge/linking.md) for full detail on domain traversal.

---

## Run Context

**Run Context** is the case-specific material attached when triggering a run. It is the counterpart to the knowledge base.

Where the knowledge base contains *how to work*, the Run Context contains *what you are working on today* — a specific contract, a customer's order, a property document, a dataset.

Run Context files are:
- Uploaded or referenced at trigger time
- Stored per-run, not in the knowledge base
- Passed to agents as part of the `THIS CASE` prompt section
- Never used as guidelines — the runtime keeps them explicitly separate

The agent prompt for every agent node is structured as:

```text
=== GUIDELINES (how to work) ===
[resolved knowledge tree]

=== THIS CASE (what you are working on) ===
[run input + Run Context files]
```

This framing is applied consistently so the agent always knows which is which.

---

## Tools

Knotwork provides four **Knotwork-native tools** that every agent node always has access to:

| Tool | Purpose |
|------|---------|
| `write_worklog` | Record observations or reasoning to the run worklog |
| `propose_handbook_update` | Propose a handbook improvement (requires human approval) |
| `escalate` | Request human intervention — pauses the run |
| `complete_node` | Signal completion with output and optional routing branch |

Agents bring their own additional tools. Knotwork does not manage a tool registry — that is the agent's concern. See [tools.md](../tools.md) for full detail.

---

## Automation Spectrum

Knotwork is useful at every level of automation. AI is additive, not required.

```
No agent     → Human-only tasks, manual runs. Fully valid.
OpenClaw     → User's existing AI handles tasks. Zero-key install.
Registered   → Dedicated agent identities per workflow. Power-user path.
```

When a node has no agent configured and no AI is connected to the workspace, it routes to a human automatically — this is not an error state. Required install environment variables: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`. No AI provider keys needed at install time.

---

## Run

A **Run** is a single execution of a graph. Every run is:
- **Async** — triggered and queued; a `run_id` and ETA are returned immediately
- **Stateful** — a shared state object flows through the graph, updated by each node
- **Inspectable** — after every node, the input, output, knowledge snapshot, and confidence score are persisted
- **Resumable** — if a run pauses (human checkpoint, escalation, timeout), it can be resumed from the same point

A run goes through these statuses:
```
queued → running → [paused] → completed
                             → failed
                             → stopped
```

`stopped` is used when a human does not respond to an escalation within the configured timeout.

Run timelines preserve immutable message history. Human corrections are captured as new artifacts
and explicit decision events rather than edits to prior agent outputs.

---

## Run State

The **Run State** is the shared data object that flows through a graph. Every node reads from it and writes to it.

The state is structured. Nodes declare what fields they read (input mapping) and what fields they write (output mapping). This makes data flow explicit and inspectable.

A snapshot of the full state is saved after every node execution.

---

## Knowledge Snapshot

When a node executes, it loads its full knowledge tree (the fragment and all fragments it links to, recursively). The exact **version ID** of every file in that tree is recorded in the **RunNodeState**.

This means you can always answer: "What exact knowledge did this agent use in that run?" — and reproduce any run with the same knowledge state.

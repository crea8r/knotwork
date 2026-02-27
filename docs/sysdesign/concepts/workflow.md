# Core Concepts — Workflow

## Graph

A **Graph** is a workflow. It defines a set of nodes and the edges connecting them. A graph represents a business process — a contract review pipeline, a customer support flow, a research-to-publish pipeline.

A graph has:
- A name and description
- A set of nodes
- A set of edges (connections between nodes)
- A trigger configuration (manual, API, scheduled)
- A default LLM configuration (overridable per node)
- An owner and access roles

A graph is designed once and run many times. Each execution is a **Run**.

---

## Node

A **Node** is a single step in a graph. Every node has a type that determines how it executes.

All nodes share a common set of properties:
- **Name** — human-readable label shown on the canvas
- **Knowledge** — one or more linked knowledge fragments
- **Input mapping** — which parts of the run state this node receives
- **Output mapping** — what this node writes back to the run state
- **Fail-safe** — what to do if the node fails or a checkpoint does not pass

### Node Types

| Type | What it does |
|------|-------------|
| **LLM Agent** | Calls an LLM with the node's knowledge, run state, and tools. Produces structured output. |
| **Human Checkpoint** | Always pauses for a human. No LLM involved. Used for required approvals. |
| **Conditional Router** | Evaluates a condition against the run state and selects the next edge. No LLM. |
| **Tool Executor** | Runs a tool directly — no LLM reasoning. Used for deterministic operations: fetch data, call API, transform. |
| **Sub-graph** *(Phase 2)* | Invokes another graph and waits for its result. |

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
- Accessible to agents via the `file.read` tool during execution
- Never used as guidelines — the runtime keeps them explicitly separate

The agent prompt for every LLM Agent node is structured as:

```text
=== GUIDELINES (how to work) ===
[resolved knowledge tree]

=== THIS CASE (what you are working on) ===
[run input + Run Context files]
```

This framing is applied consistently so the LLM always knows which is which.

---

## Tool

A **Tool** is a capability an agent or executor can invoke during a run. Tools allow agents to act — not just reason.

Tools exist in a **Tool Registry** and are attached to nodes. A node's tools are available to its LLM agent during execution.

Tool categories:
- **Function tools** — Python functions called via LLM tool-use
- **HTTP tools** — External API calls
- **RAG tools** — Retrieve relevant chunks from a document collection
- **Lookup tools** — Structured data (tables, JSON) queried by key
- **Rule tools** — Deterministic logic encoded as human-defined rules

See [tools.md](../tools.md) for full detail.

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

---

## Run State

The **Run State** is the shared data object that flows through a graph. Every node reads from it and writes to it.

The state is structured. Nodes declare what fields they read (input mapping) and what fields they write (output mapping). This makes data flow explicit and inspectable.

A snapshot of the full state is saved after every node execution.

---

## Knowledge Snapshot

When a node executes, it loads its full knowledge tree (the fragment and all fragments it links to, recursively). The exact **version ID** of every file in that tree is recorded in the **RunNodeState**.

This means you can always answer: "What exact knowledge did this agent use in that run?" — and reproduce any run with the same knowledge state.

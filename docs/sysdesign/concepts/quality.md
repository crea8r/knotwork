# Core Concepts — Quality & Control

## Checkpoint

A **Checkpoint** is a validation rule attached to a node. After the node produces output, its checkpoints are evaluated. If any checkpoint fails:

1. Apply the node's fail-safe action (if configured)
2. Otherwise retry up to the configured retry limit
3. If retries are exhausted, escalate to human

Checkpoints can be:
- **Rule-based** — pattern matching, field presence, value ranges
- **LLM-evaluated** *(Phase 2)* — a judge LLM scores the output against criteria

---

## Confidence

**Confidence** is a measure of how certain an LLM Agent node is about its output. It has two sources:

- **Structured output** — the LLM is instructed to include a `confidence` score (0–1) in its response
- **Rule-based signals** — configurable conditions that override or adjust the score (e.g. "if output contains 'I am not sure', set confidence = 0.3")

When confidence falls below the node's configured threshold, the run is paused and an escalation is sent to a human.

---

## Escalation

An **Escalation** is a pause in a run that requires human input. It can be triggered by:
- Low confidence
- Checkpoint failure (after retries)
- A Human Checkpoint node
- An explicit error in a node

When escalated, the human receives a notification (in-app, email, Telegram, or WhatsApp) with a summary. They can then:
- **Approve** the agent's output and continue
- **Edit** the output and continue
- **Provide guidance** for the agent to retry
- **Abort** the run

See [human-in-loop/escalation.md](../human-in-loop/escalation.md) for full detail.

---

## Knowledge Health

**Knowledge Health** is a 0–5 score per fragment that reflects how reliably it performs in production. It is derived from token count, average confidence scores, escalation rate, and human ratings across recent runs.

Health is the primary signal users get about whether their knowledge is working. It surfaces in the file tree, node configuration panel, and post-run screens. It is the connection the product draws — repeatedly, over time — between knowledge quality and agent behaviour.

See [knowledge/health.md](../knowledge/health.md) for the full scoring model.

---

## Rating

After a node completes, its output can be **rated**. Ratings are collected from:

- **Human review** — an operator explicitly rates the output (1–5 scale + optional comment)
- **LLM judge** *(optional, Phase 2)* — a separate LLM evaluates the output against the node's knowledge

Rating results feed directly into the fragment's Knowledge Health score and surface improvement opportunities via the improvement loop.

---

## Role

Access to Knotwork resources is controlled by **Roles**. Phase 1 has two built-in roles:

| Role | Capabilities |
|------|-------------|
| **Owner** | Full access: design graphs, edit knowledge, manage tools, view all runs, manage members |
| **Operator** | Run graphs, view runs, handle escalations, rate outputs. Cannot edit graphs or knowledge. |

A user can have different roles in different workspaces.

---

## Workspace

A **Workspace** is the top-level organisational unit. A company or team has one workspace. All graphs, knowledge, tools, runs, and members belong to a workspace.

---

## Audit Log

Every significant action is recorded in the **Audit Log**: knowledge edits (who changed what file, what version was created), run events (trigger, node completion, escalation, rating), and access changes. The audit log is append-only.

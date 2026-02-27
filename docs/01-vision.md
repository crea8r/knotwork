# Knotwork — Product Vision

## What It Is

Knotwork is a visual agent workflow platform for non-technical operators. Users design AI-powered business processes through conversation and a drag-and-drop canvas, then run and monitor them day-to-day — on any device.

Every step in a workflow carries its own upgradable knowledge: instructions, guidelines, quality checkpoints, and a feedback loop so the process gets better over time.

## The Problem

Business logic lives in people's heads, in scattered documents, or in impenetrable automation flows that no one can debug. When an AI agent runs that logic, it becomes a black box:

- No one knows if the agent is following the intended process
- When something goes wrong, there is no way to trace why
- Knowledge is locked to one person and cannot be shared or improved systematically
- Non-technical operators — the people who actually run the business — are excluded from building and improving these processes

## The Solution

Knotwork makes agent workflows:

| Property | What it means |
|----------|--------------|
| **Visible** | Every run shows exactly what happened at each step — inputs, outputs, which knowledge was used |
| **Legible** | Workflows are designed in plain language and visualised as a graph anyone can read |
| **Improvable** | Each step has versioned knowledge that humans and agents can refine over time |
| **Operable** | Non-technical users can design, run, monitor, and intervene — from a tablet or phone |

## Who It Is For

**Graph Designer** — Builds and edits workflows. Describes the process in chat, refines it on the canvas, manages knowledge files.

**Graph Operator** — Runs workflows daily, handles escalations, reviews agent outputs, rates quality.

**Knowledge Worker** — Owns and maintains specific knowledge fragments. May be an internal employee or an external agent.

These roles can overlap. A small team may have one person doing all three.

## Core Design Principles

1. **Chat is the primary design surface.** No one wants to drag and drop a workflow from scratch. They want to describe it and see it take shape.

2. **Knowledge is a first-class citizen.** Instructions are not buried in prompts. They are files — owned, versioned, linkable, improvable.

3. **Every run is transparent.** The graph shows the current execution state. Every node's input and output is inspectable. The knowledge version used is logged.

4. **Humans are always in the loop.** Either by design (human checkpoint nodes) or on demand (confidence-based escalation). The system never silently fails.

5. **LLMs are replaceable.** The platform is model-agnostic. Switching providers is a configuration change, not a rewrite.

6. **Mobile and tablet first.** Business operators are not at desks. Every action — designing, operating, escalating — must work on a phone.

7. **The platform is its own best user.** Knotwork uses its own patterns internally: the workflow designer is an agent graph, knowledge is stored as knowledge fragments.

## The Philosophy: Knowledge Over Models

The LLM is a commodity. Anyone can access GPT-4 or Claude. What no one can copy is your organisation's accumulated knowledge — the procedures your team has refined over years, the red flags your experts have learned to spot, the edge cases your best people know how to handle.

**Agents are only as good as the knowledge they are given. The LLM just executes it.**

This means the investment that compounds over time in Knotwork is not the AI configuration — it is the knowledge base. A well-structured, continuously improved set of guidelines is the difference between an agent that works reliably and one that needs constant supervision.

Knotwork is designed to make this visible and actionable:

- Every run traces its outcome back to the specific knowledge used
- Low-performing nodes surface the fragments that need improvement
- The quality of the knowledge base is measurable — not as a technical metric, but as a business outcome: fewer escalations, higher confidence, better ratings
- Users are gradually shown this connection until it becomes intuitive: **good documentation is the make-or-break of your agents, and hence your operations**

This is why Knotwork treats the knowledge base as a company handbook — not a file dump. The structure, clarity, and maintenance of that handbook is the primary lever users have over agent quality. The product's job is to make that lever as easy to pull as possible, and to keep showing users when pulling it makes a difference.

---

## What It Is Not

- Not a developer tool (no code required to use)
- Not an API integration platform (n8n, Zapier)
- Not a visual LangChain playground (Langflow, Flowise)
- Not a black-box AI assistant

## Positioning

Knotwork occupies a gap no current tool fills:

> **An operations platform for continuously improvable, human-supervised agent workflows — designed for the people who run the business, not the people who build the software.**

## Phase 1 Scope

| Feature | Included |
|---------|----------|
| Chat-based graph designer | Yes |
| Drag-and-drop canvas (tablet-friendly) | Yes |
| Import workflow from existing MD file | Yes |
| LLM Agent node | Yes |
| Human Checkpoint node | Yes |
| Conditional Router node | Yes |
| Tool Executor node | Yes |
| Knowledge system (MD files, wiki-links, versioning) | Yes |
| Knowledge size / token flagging | Yes |
| Run execution with per-node state inspection | Yes |
| Human escalation: in-app + Telegram + WhatsApp + email | Yes |
| Human rating + improvement suggestions (A+B loop) | Yes |
| Built-in tool registry (core tools) | Yes |
| Role-based access (owner + operator) | Yes |
| Async runs with ETA | Yes |
| Cloud-first deployment | Yes |

## Phase 2 Scope

- Scheduled (cron) runs
- Sub-graph nodes
- LLM judge for automated rating
- Autonomous knowledge improvement (opt-in)
- Full MCP surface
- Slack integration
- Self-hosted deployment option
- Advanced roles and permissions

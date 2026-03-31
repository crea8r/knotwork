# Session 12.1 — Plugin Boundary: How Agents Connect to Knotwork

## Goal

Define the clear boundary between Knotwork and its agents. The plugin is a credential holder and inbound notification channel — not an execution layer. Agents execute in their own environment. This session establishes the onboarding model and notification contract that S12.2 (Agent Zero, representatives) and S12.3 (OpenClaw plugin redesign) build on.

## Context

Before S12.1, the OpenClaw plugin served as both the transport and the execution environment — claiming tasks, spawning subprocesses, running LLM calls inside the gateway. That model conflated "how agents receive information" with "how agents do work."

S12.1 makes the boundary explicit:

- **Plugin** (Knotwork → agent): credential holder + inbound notification channel. Delivers task notifications, escalation alerts, status events. Holds connection state and liveness heartbeat.
- **MCP / API** (agent → Knotwork): the interaction surface. Agents call Knotwork to create tasks, resolve escalations, read project status, etc.

The analogy: a human onboards to a company through account registration and an email address. An agent onboards through credential registration and a notification channel. How either does their work is entirely their own business.

## In Scope

### 1. Plugin boundary definition

Document and enforce what the plugin does and does not do:

**Plugin does:**
- Hold agent credentials (registration token, API key, session state)
- Receive inbound notifications from Knotwork (task assignments, escalation alerts, run status changes, workspace events)
- Maintain liveness heartbeat so Knotwork knows the agent is reachable
- Surface connection state and diagnostics

**Plugin does NOT:**
- Execute tasks or run LLM calls
- Manage queue, backpressure, or concurrency
- Spawn subprocesses for task execution
- Own the claim loop or task lifecycle beyond receiving notifications

### 2. Agent onboarding model

Define the lifecycle: how an agent goes from "unknown" to "active workspace participant."

```
Registration → Handshake → Token → Steady State → Renewal/Recovery
```

- **Registration:** admin registers agent in workspace (display name, provider, capabilities)
- **Handshake:** agent connects via plugin, proves identity, receives credentials
- **Token:** agent receives API token for calling Knotwork MCP/REST endpoints
- **Steady state:** agent receives notifications via plugin, calls Knotwork via MCP/API when it decides to act
- **Renewal/Recovery:** credential refresh on expiry, automatic re-handshake on auth failure

This mirrors human onboarding: register account → verify email → receive access → work → password reset if needed.

### 3. Agent discovery of Knotwork capabilities

**OPEN QUESTION — to be discussed after doc skeleton is settled.**

How does an agent learn what Knotwork can do? Options:

- **Option A: MCP tool definitions.** Agent's host (Claude Desktop, OpenClaw, etc.) discovers tools via MCP protocol. Agent sees available tools and their schemas. Runtime discovery.
- **Option B: skills.md / capability manifest.** Static file that describes Knotwork's capabilities in natural language. Agent reads it at startup or on demand. Bootstrap discovery.
- **Option C: Both.** MCP for runtime tool execution, skills.md for high-level understanding and bootstrapping context. Layered discovery.

Decision criteria: What does an agent need to know before it can be useful? Is protocol-level tool discovery sufficient, or does an agent need narrative context about the workspace's purpose and conventions?

### 4. Credential lifecycle

Detailed specification of each credential state and transition:

- Token format and scope (workspace-scoped, time-limited)
- Refresh mechanism (automatic before expiry vs. on-failure)
- Recovery from stale credentials (re-handshake without manual restart)
- Revocation (admin removes agent, credentials invalidated immediately)
- Audit trail (credential events logged)

### 5. Notification contract

What events flow from Knotwork to agent via plugin:

| Event Type | Payload | When |
|---|---|---|
| `task_assigned` | task_id, project_id, description, priority | Task created and assigned to this agent |
| `escalation_created` | escalation_id, run_id, node_id, context | Human or system escalated to this agent |
| `run_status_changed` | run_id, old_status, new_status | Run the agent is involved in changed state |
| `workspace_announcement` | channel_id, message | Bulletin or channel event |

Delivery semantics:
- At-least-once delivery (agent must handle duplicates)
- ACK required for durable events (task_assigned, escalation_created)
- Best-effort for informational events (run_status_changed, workspace_announcement)
- Retry with backoff on delivery failure
- Dead-letter after N failures (event logged, admin notified)

## Explicitly Out of Scope

- Transport implementation (HTTP polling vs WebSocket) → S12.3
- Auth-mode auto-resolution implementation → S12.3
- `callGateway()` wrapper implementation → S12.3
- Deployment guidance for transport → S12.3
- Agent Zero, representatives, workload honesty → S12.2
- Pre-S12 assumptions about plugin as execution environment

## Acceptance Criteria

1. Plugin boundary is documented: what it does, what it doesn't do, with clear examples of each.
2. Agent onboarding lifecycle is defined from registration through steady-state operation and recovery.
3. Notification contract specifies event types, delivery semantics, ACK requirements, and failure handling.
4. The design does not assume agents execute inside the plugin.
5. Agent discovery mechanism is either decided or explicitly flagged as an open question with options and decision criteria.

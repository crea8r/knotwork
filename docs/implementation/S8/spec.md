# Session 8: Chat-First Agent Runtime

## Context

S7.2 delivered conversational shell UX, but S8 initially modeled capability/preflight mostly as metadata and test tables.
This revision makes chat the source of truth for agent interaction.

---

## Product Direction

### Core thesis

**Knotwork is chat-native: every agent interaction is a chat session, and users see the same transcript the agent sees.**

### Positioning

- OpenClaw remains primary runtime path.
- OpenAI/Claude remain <span style="color:#c1121f;font-weight:700">LEGACY / TRANSITIONAL</span>.

---

## What will be built

### 1. Main Session Chat (per agent)

- Each registered agent has a persistent main session chat.
- Main session stores:
  - preflight conversation,
  - general agent-level consultation outside workflow design.

### 2. Preflight is chat

- Preflight sends a structured prompt asking agent to list skills/tools.
- Capability contract is derived from chat response (skills/tools list), not handshake metadata alone.
- `file` and `shell` skills are filtered out from user-visible capability.

### 3. Workflow design consultation is per-workflow chat

- User can ask agent in design context how it will execute instructions with handbook info.
- This consultation is persisted in the workflow chat session (separate from preflight main chat).

### 4. Run = new chat session

- Every run creates a dedicated run chat session.
- Agent messages, escalation questions, and human replies are persisted in that run session.
- Run Detail renders this run session as authoritative timeline.

### 5. Handshake role stays connectivity/auth

- Plugin handshake remains required for integration and runtime bridge auth.
- Handshake metadata is not treated as sole capability source for user trust UX.

---

## Backend scope

- Internal channel/session model:
  - `agent_main` channel (per workspace+agent),
  - `workflow` chat channel (per workflow/graph design context),
  - `run` channel (per run).
- Persist run chat messages (`channel_messages.run_id`).
- Preflight chat write path:
  - preflight prompt message,
  - agent reply message,
  - derive visible skills/tools from reply.
- Run execution write path:
  - assistant node outputs,
  - escalation questions,
  - human escalation decisions.
- Run chat endpoint for UI (`/runs/:id/chat-messages`).

---

## Frontend scope

- Agent profile:
  - capability section labeled as unified `Skills & Tools`,
  - latest preflight detail shows chat-derived skills/tools.
- Run Detail:
  - render persisted run chat messages first,
  - fallback to legacy synthesized timeline only when no chat exists.

---

## Acceptance criteria

1. Preflight appends prompt/reply in agent main session chat.
2. Workflow design consultation is stored in workflow chat, not in `agent_main`.
3. User-visible capability list excludes `file` and `shell` skills.
4. Every run has its own chat session and persisted messages.
5. Run detail shows the same persisted run chat transcript users and agent operate on.
6. Escalation question and human resolution are both visible in run chat.

---

## Out of scope

- Full replacement of legacy designer chat storage in this slice.
- Provider deprecation removal.
- S8.1 auth/RBAC hardening.

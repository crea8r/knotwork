# Session 8.3 — Prompt Architecture Refactor

## What Was Built

### Prompt block order fix
- ROUTING and COMPLETION PROTOCOL moved from `system_prompt` to the end of `user_prompt` (the message). This ensures the agent reads these blocks immediately before responding, not before reading the case.

### First-node detection
- `is_first_node = not all_outputs` — when `node_outputs` is empty, no prior node has completed.
- First node receives run input in `THIS CASE` block.
- Subsequent nodes omit `THIS CASE` entirely — session/conversation history carries prior context.

### Input sources removal
- `input_sources` config field removed from frontend UI (AgentNodeConfig.tsx, LlmAgentConfig.tsx).
- `input_sources` logic removed from all backend adapters: agent.py, claude.py, openai_adapter.py, openclaw.py.
- Natural flow: each node's input = previous node's output via session history.

### Routing escalation
- When agent completes with `next_branch_val = None` on a multi-branch node → fires escalation with `questions=[], options=_targets`.
- Human picks branch via the branch-picker UI in `EscalationDetailPage`.

### Grouped escalation questions
- All escalation events from a generator run are collected before a single `interrupt()` call.
- Questions arrive grouped into one escalation record instead of one per question.

### Retry prompt structure
- After escalation resolution `request_revision`: `system_prompt = ""`.
- `user_prompt = === HUMAN INTERVENTION === + guidance + === ROUTING === + === COMPLETION PROTOCOL ===`.

### Condition label enforcement
- Multi-branch edges (≥2 outgoing from same node) MUST have `condition_label`.
- `validate_graph()` (backend) and `validateGraph.ts` (frontend) both enforce this.
- Missing label blocks run start.

### EscalationResolve schema extension
- `answers: list[str] | None` — indexed answers for Q&A escalations.
- `next_branch: str | None` — human-chosen branch for routing escalations.

## Breaking Changes

None. All changes are additive or replace internal logic.

## Key Design Decisions

1. **Session continuity**: OpenClaw session key = `knotwork:<agentSlug>:<wsId>:run:<runId>` — shared across all nodes in a run. Prior outputs already in conversation history. Injecting them again is redundant and potentially stale.
2. **THIS CASE scope**: Run input is for cold-start context only. Once the conversation begins, the agent tracks context itself.
3. **Retry = no system_prompt**: On retry, only the human's feedback + routing + completion protocol. No guidelines re-injection (they're already in the model's context window from the first turn).

## OpenClaw Subagent Lifecycle (Discovered Post-Ship)

Each node execution calls `subagent.run(sessionKey, message)` → `subagent.waitForRun(runId)`. The underlying agent **process is killed after every `waitForRun()` returns**. The session transcript (JSON on disk) persists; the process does not.

Consequences:
- **Every node re-reads the full conversation history from scratch.** A 5-node run where each node's response is ~3k tokens means node 5 loads ~15k tokens of prior context before doing any work.
- **Token cost compounds linearly with node count.** Each additional node adds one full prior turn to the context every subsequent node must read.
- **Context window is the hard ceiling.** OpenClaw `gpt-5.2` context = 272,000 tokens. A very long run (many nodes + large outputs) will eventually compact (mode = `safeguard`) or fail.
- **Max concurrent**: `agents.defaults.maxConcurrent = 4` (agent sessions), `agents.defaults.subagents.maxConcurrent = 8`. These are gateway-level limits, not Knotwork limits. If a run triggers more concurrent nodes than `maxConcurrent`, excess tasks queue in the DB as `pending` until a slot frees.
- **Session cleanup**: Sessions are never auto-deleted. They accumulate until `openclaw sessions cleanup` is run manually. 38 sessions in store as of 2026-03-21.

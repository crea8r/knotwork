# Session 12.4 — Bridge Fixes, Prompt Optimization, and Guidelines

## Goal

Host the follow-up fixes and prompt/guideline optimization that should not block closing S12.2's bridge-layer work.

S12.2 delivered the workspace guide, agent onboarding surface, OpenClaw bridge rewrite, ed25519 auth, inbox polling, and MCP-backed semantic flow. S12.4 is the cleanup lane for live runtime behavior, semantic prompt quality, guideline tuning, and retest hardening discovered while validating S12.2.

## Context

The April 8 S12.2 retest confirmed:

- File-bound `knowledge.propose_change` now works through the OpenClaw MCP transport.
- Folder-bound and run-bound semantic context now work without leaking raw `json-action` blocks.
- Basic semantic `channel.post_message` cases still work.
- MCP result normalization belongs in the OpenClaw plugin transport adapter, not in the shared MCP client.

The remaining issues are no longer bridge-foundation blockers, but they do need a focused follow-up session before treating the live OpenClaw experience as polished.

## In Scope

### 1. Live OpenClaw Runtime Fixes

- Investigate the `F4` handoff/mention probe that reached `task:received` and then emitted heartbeats without completing.
- Clarify whether the task was actually still running, stale in logs, or stuck in the OpenClaw subagent runtime.
- Improve timeout, heartbeat, and completion observability so a stuck task is diagnosable from `knotwork.status` and `tasks.log`.
- Re-run `F4` after the runtime state is clear.

### 2. Escalation Validation Follow-up

- Repair or replace the workflow graph used for escalation validation so it has valid supervisors.
- Produce a fresh open escalation and validate:
  - `G1`/`G2`/`G3` semantic escalation resolution behavior
  - `J4` escalation-bound context behavior
- Keep the validation tied to real live OpenClaw handling rather than mocked MCP calls.

### 3. Prompt And Guideline Optimization

- Review the semantic prompt instructions for channel actions, file proposals, folder context, run context, and escalations.
- Tighten guideline wording so the agent prefers MCP/Knotwork context for attached assets instead of local filesystem guessing.
- Ensure user-visible replies never expose raw action JSON on successful semantic dispatch.
- Improve fallback copy for malformed semantic actions so failures are clear without polluting the channel.

### 4. Duplicate Delivery Watch

- Keep watching for duplicate handling across `mentioned_message` and `message_posted`.
- If duplicates reproduce, deduplicate at the plugin event/task boundary using the inbox delivery/event identity.
- Re-run the `L` regression checks after the runtime issue is resolved.

### 5. Validation Harness Hardening

- Keep the S12.2 retest harness pointed at the test MCP key.
- Treat both `path` and `target_path` as valid knowledge-change path fields.
- Add clearer timeout diagnostics for live OpenClaw tasks that are received but do not complete.

## Out of Scope

- Workspace guide storage and Settings UI (done in S12.2)
- Agent onboarding copy and discovery URL flow (done in S12.2)
- OpenClaw ed25519 auth and inbox polling rewrite (done in S12.2)
- Shared `mcp-client` behavior changes unless a non-OpenClaw consumer proves the same shape mismatch
- Agent Zero, representatives, and workload honesty product surfaces (S12.3)

## Acceptance Criteria

1. `F4` live mention/handoff probe completes reliably or fails with a clear, bounded runtime error.
2. Escalation semantic tests `G1`/`G2`/`G3` and asset-aware `J4` are validated against a fresh real escalation.
3. Semantic prompts/guidelines consistently prefer Knotwork MCP/API context for attached assets.
4. Successful semantic dispatches do not leak raw `json-action` blocks into visible channel replies.
5. Duplicate delivery does not reproduce in the `L` regression checks, or a deduplication fix is implemented and validated.
6. The retest harness reports field-shape and timeout failures clearly enough to distinguish product bugs from test harness assumptions.

# Session 12.2 Test Report

Date: 2026-04-04

Workspace:
- `1bc45fc5-74c7-435e-96f9-0881ea49a24f`

Test method:
- Used the TypeScript Knotwork MCP client against `http://127.0.0.1:8000/mcp/`
- Drove live channel interactions through MCP
- Observed resulting channel messages and `/Users/hieu/.openclaw/extensions/knotwork-bridge/tasks.log`

## Summary

S12.2 is complete as the bridge-layer delivery. Semantic action handling is live, the OpenClaw plugin is using the bridge/MCP path, and file-bound `knowledge.propose_change` now works after the April 8 MCP transport normalization fix.

Earlier duplication and file-proposal failures are preserved below as validation history. Remaining live-runtime polish, escalation retest setup, duplicate-delivery watch, and prompt/guideline optimization have been promoted to S12.4.

## Retest Update

Retested `F`, `J`, and `L` later on 2026-04-04 after the OpenClaw gateway restarted. The duplication regression did not reproduce in the fresh `F` and `L` probes. `J1` still failed, `J2` and `J3` passed, and `J4` remained blocked because there was still no open escalation in the workspace.

Retested again on 2026-04-08 after the OpenClaw MCP transport was synced to the live extension.

- Fixed live MCP transport result normalization in the OpenClaw plugin:
  - raw MCP text-content envelopes are parsed before semantic code consumes them
  - MCP list tools normalize to arrays even when the server returns exactly one item
- `J1` now passes. The file-bound channel created a pending `knowledge.propose_change` for `writing/codex-mcp-note.md` with token `RJ1-1775624192548`.
- `J2` passes. The folder-bound reply cited real attached folder entries including `skills/document-text-extract/` and `skills/paste/`, with no raw `json-action` leak.
- `J3` passes. The run-bound reply reported the run as completed and no escalation, with no raw `json-action` leak.
- `J4` remains blocked because there is still no open escalation available for live validation.
- `F1`, `F2`, and `F3` pass after the MCP transport fix.
- `F4` did not complete within the harness window. The delivery `ac287166-82f3-4299-878d-06f5886d53e6` reached `task:received` and then emitted task heartbeats instead of completing. This appears to be a separate live OpenClaw thinking/runtime delay, not the MCP result-shape bug.
- `L` was not rerun in this pass because the `F4` probe left a long-running heartbeat task in the live OpenClaw runtime.

Completion judgment: S12.2 is complete. The MCP/file-bound semantic path is now working. Escalation validation remains blocked and the live `F4` handoff/mention probe exposed a separate hanging-task issue, but those are promoted to S12.4 as follow-up runtime/prompt validation work rather than S12.2 bridge-foundation blockers.

## Results

### F. Semantic Action: `channel.post_message`

- `F1` Pass
  - Prompt required a full-envelope semantic reply.
  - Observed channel output: plain payload text only.
  - Example: `F1-1775317760191 PASS`

- `F2` Pass with regression
  - Prompt required shorthand `channel.post_message`.
  - Observed expected plain payload text.
  - Same output was posted twice.

- `F3` Pass
  - Prompt required `control.noop`.
  - No visible channel message was posted.

- `F4` Pass with regression
  - Prompt required asking `@hieu` in a normal message.
  - Observed normal visible mention message.
  - Same output was posted twice.
  - Example: `@hieu can you take a look at this one? Token: F4-1775317815161`

Retest on 2026-04-04 23:28 +07:

- `F1` Pass
  - One visible reply only.
  - Output: `RF1-1775319822741 PASS`

- `F2` Pass
  - One visible reply only.
  - Output: `RF2-1775319848239 PASS`
  - The earlier duplication did not reproduce.

- `F3` Pass
  - No visible channel message was posted.

- `F4` Pass
  - One visible reply only.
  - Output: `@hieu can you take a look at this one? Token: RF4-1775319891561`
  - The earlier duplication did not reproduce.

### G. Semantic Action: `escalation.resolve`

- `G1` Blocked
- `G2` Blocked
- `G3` Blocked

Reason:
- Could not produce a fresh real escalation through public MCP.
- Triggering the known graph failed with backend validation:
  - `Node "CTA Check" is missing a supervisor`
  - `Node "Self-Test" is missing a supervisor`
  - `Node "Write Copy" is missing a supervisor`
  - `Node "Understand Request" is missing a supervisor`
  - `Node "Gather Specifics" is missing a supervisor`

### H. Semantic Action: `knowledge.propose_change`

- `H1` Fail
  - Asked the agent in the file-bound channel for `writing/codex-mcp-note.md` to create a proposal.
  - No knowledge change proposal was created.

- `H2` Fail
  - No proposal was created, so source-channel preservation could not be verified.

- `H3` Fail
  - File-bound proposal generation did not succeed.

Relevant log evidence:
- `task:semantic-failed ... shorthand knowledge.propose_change requires path, proposed_content, and reason`

### I. Capability Model

- `I1` Partial pass
  - Cross-channel posting clearly works beyond the trigger channel.
  - The runtime successfully posted from `test agent` into `folder: skills`.
  - Full capability snapshot was not directly inspected from runtime internals.

- `I2` Pass with regression
  - Triggered in `test agent`.
  - Asked the agent to post into subscribed channel `d46c4d20-fe6e-4c3a-9fe7-c5bd60f0c1bd` (`folder: skills`).
  - Observed target-channel message:
    - `I2-1775317783742 PASS`
  - Same output was posted twice.

- `I3` Inconclusive
  - Used `handbook-chat` as the target assumed to be unauthorized.
  - The post succeeded, so that channel is apparently allowed for the agent.
  - No clearly unauthorized target channel was identified during this run.

### J. Asset-Aware Context

- `J1` Fail
  - File-bound semantic proposal flow did not succeed in `file: writing/codex-mcp-note.md`.

- `J2` Partial pass
  - Existing earlier live response in `folder: skills` used actual folder contents:
    - `skills/build-landing-page/`
    - `skills/document-text-extract/`
    - `skills/excalidraw-board/`
    - `skills/paste/`
  - A fresh follow-up folder-summary prompt did not produce a new response within the test timeout.

- `J3` Not validated
  - No clean run-bound response was captured during this run.

- `J4` Blocked
  - No fresh live escalation was available for semantic handling validation.

Retest on 2026-04-04 23:28 +07:

- `J1` Fail
  - Asked again in `file: writing/codex-mcp-note.md` for a file-bound knowledge proposal.
  - No new knowledge change proposal was created.

- `J2` Pass
  - Fresh folder-bound reply used actual attached folder context and cited real entries:
    - `skills/document-text-extract/`
    - `skills/paste/`
    - also mentioned `skills/build-landing-page/`
  - Example reply included token `RJ2-1775319818812`.

- `J3` Pass
  - Fresh run-bound reply returned grounded run context.
  - Example:
    - `Run status: completed`
    - `Escalation: none`
  - Example reply included token `RJ3-1775319829055`.

- `J4` Blocked
  - Still no open escalation available in the workspace during the retest.

### K. Logs And Observability

- `K1` Pass
  - Log contains semantic success lines such as:
    - `task:semantic ... batch="applied"`

- `K2` Pass
  - Log contains semantic failure lines such as:
    - `task:semantic-failed ... shorthand knowledge.propose_change requires path, proposed_content, and reason`
  - Also observed failed task handling for deliberate malformed-action prompt:
    - task status `failed`
    - no raw malformed JSON posted to the channel

- `K3` Pass
  - Successful semantic channel actions posted only payload content.
  - Raw fenced `json-action` blocks were not echoed for successful semantic dispatches.

### L. Regression

- `L1` Fail
  - Duplicate visible replies observed repeatedly.
  - Same prompt is being handled via both `mentioned_message` and `message_posted`.
  - This caused duplicate outputs for at least `F2`, `F4`, `I2`, and the `I3` attempt.

- `L2` Pass
  - Plugin restart did not break semantic handling.
  - After restart, plugin continued authenticating, polling, and dispatching semantic actions.

- `L3` Partial pass
  - Auth, inbox polling, and semantic channel posting still work.
  - Duplication regression remains.

Retest on 2026-04-04 23:28 +07:

- `L1` Pass
  - Fresh mention test produced exactly one visible reply:
    - `RL1-1775319916909 mention`
  - The earlier duplicate-processing regression did not reproduce in this probe.

- `L2` Not re-tested in this pass
  - No fresh restart-specific validation was performed in the retest run.

- `L3` Pass
  - Fresh semantic-response test produced exactly one normal visible reply:
    - `Software testing reduces risk by catching bugs early; RL3-1775319934007.`

## Key Findings

1. Semantic success path is working.
   - `channel.post_message` is dispatched correctly and cleanly.

2. Duplicate inbox handling was observed earlier, but did not reproduce in the latest retest.
   - Earlier results showed duplicate handling across `mentioned_message` and `message_posted`.
   - Fresh `F2`, `F4`, and `L1` probes after restart each produced exactly one visible reply.

3. `knowledge.propose_change` now works in live use after the 2026-04-08 MCP transport normalization fix.
   - The fresh file-bound retest created pending proposal `367b6255-b119-433e-90e4-a53b0e837ce4` for `writing/codex-mcp-note.md`.

4. Escalation validation is blocked by backend/runtime setup.
   - Could not generate a fresh escalation because the available graph is currently invalid.

5. A separate live OpenClaw runtime issue remains.
   - `F4` timed out after delivery `ac287166-82f3-4299-878d-06f5886d53e6` reached `task:received`; the task emitted heartbeats and did not complete within the harness window.

## Recommended Next Fixes

Promoted to S12.4:

1. Investigate the live OpenClaw long-running task behavior observed in `F4`.
2. Repair the workflow graph supervisor configuration so escalation tests can run end to end.
3. Re-run `G`, `J4`, `F4`, and `L` after the live runtime is clear.
4. Optimize semantic prompts and workspace guidelines so the agent consistently uses Knotwork/MCP context for attached assets.
5. Keep watching for duplicate handling across `mentioned_message` and `message_posted`, since it was real earlier and duplicate deliveries still appear during retests.

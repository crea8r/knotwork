# Session 7.2: Conversational Shell + Decision Model

**Status:** ✅ Completed  
**Completion basis:** spec acceptance criteria + runtime UX hardening through latest implementation pass.

## Context

S7 and S7.1 established the unified agent runtime and agent registration, but the product UX was still split by strict mode boundaries (Designer vs Operator) and legacy screen groupings. Team feedback showed real work behaves like a continuous chat environment where workflows, runs, and escalations are conversation states rather than separate tools.

S7.2 defined a **thread-first shell** that keeps Knotwork's structured execution model while adopting a single conversational UX pattern.

---

## Product Direction

### Core thesis

**Everything is a thread, backed by explicit state.**

- Workflow design: a design thread with structured graph deltas.
- Run execution: an execution thread with agent/human/system events.
- Escalation: a thread event requiring a decision with SLA.

### Non-negotiable interaction rule

**Messages are immutable for humans and agents.**

Operational corrections happen through decision actions and follow-up messages, not by editing prior outputs.

---

## Delivered in S7.2

### 1. Navigation and shell behavior

- Fixed shared navigation mental model.
- Thread-first run detail and handbook chat surfaces.
- Small-screen panel focus/collapse behavior to reduce fragmented multi-panel overload.

### 2. Decision model normalization

Escalation and human-in-the-loop actions are explicit decision events:
- `accept_output`
- `override_output`
- `request_revision`
- `abort_run`

### 3. Timeline-first run UX

- Chat and decision events are rendered chronologically.
- Agent/human attribution is visible per message.
- Active processing states are visible (agent thinking/working).
- User replies are gated while agent is producing multi-part output.

### 4. Handbook chat and proposal integration

- Handbook chat is first-class and proposal actions are integrated into chat flow.
- Proposal decisions are explicit (`approve/edit/abort` behavior mapped to decision semantics).

### 5. Observability and debugging uplift

- Rich run debug surface: prompt attempts, provider payload slices, tool call input/output logs, and cross-linked runtime IDs.
- Better diagnosis for pause/resume/escalation loops.

---

## Gap distilled: original S7.2 plan vs current software

### Closed gaps

1. Decision naming inconsistency (`guided` vs `request_revision`, etc.) is resolved to one canonical set.
2. Run thread ordering and visibility are now timeline-first instead of fragmented table-first.
3. Human escalation lifecycle now reflects chat UX, including explicit pending/working signals.
4. Run deletion lifecycle is complete for stopped/failed/completed cases (including detail screen parity).

### Remaining intentional carry-over to S8

1. <span style="color:#c1121f;font-weight:700">LEGACY</span> multi-provider ambiguity (OpenAI/Claude/OpenClaw capability opacity) still creates user confusion at design time.
2. Agent tool constraints are still partially provider-blackbox for non-OpenClaw paths.
3. Agent onboarding does not yet provide a single capability contract + test bench flow before production use.

These are now elevated as primary Session 8 scope.

---

## Acceptance criteria (locked and satisfied)

1. Default nav order matches S7.2 spec grouped order and remains fixed.
2. Escalation response UI uses four explicit decision actions with no direct message mutation.
3. `override_output` creates a new human-authored authoritative output while preserving prior agent output.
4. Thread timeline displays message log plus decision log in chronological order.
5. Inbox/thread surfaces show pending action and state transitions clearly.
6. Handbook chat supports proposal-driven edits/restructure with explicit human approval before mutation.

---

## Key decisions

1. **One chat UX across all work**; workflows are distilled assets, not the only working surface.
2. **No message mutation** for either humans or agents.
3. **State transitions must be explicit decisions**, not inferred from edited content.
4. **Distillation remains separate intentional work**; no forced conversation-to-workflow conversion.
5. **Provider/toolbox clarity moves to S8** as a first-class onboarding and runtime transparency problem.

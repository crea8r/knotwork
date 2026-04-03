# Historical S10 Spec — OpenClaw Workload Honesty Rethink

## Goal

Preserve the product requirement that agent workload must be honest and visible, while deferring the implementation until after S12 clarifies whether those semantics belong in the OpenClaw plugin, MCP-facing agent integration, or some other runtime boundary.

## Context

The original S10 concept assumed the current OpenClaw plugin remained a two-way execution/runtime participant: Knotwork would create tasks, the plugin would claim them, and plugin-side claim strategy would become the core place to enforce honest queue semantics.

That assumption is no longer stable. S12 and S12.1 explicitly reconsider the boundary between OpenClaw and MCP:

- MCP becomes the agent -> Knotwork interaction surface
- the OpenClaw plugin is expected to shrink toward inbound Knotwork delivery
- execution/runtime coordination may no longer live where the original S10 design put it

So the underlying problem remains real, but the current solution shape should not be implemented yet.

## In Scope

### Preserve the problem statement for later redesign

- Agents should never silently overload.
- Operators need explicit visibility into whether work is unclaimed, queued, actively running, stalled, or orphaned.
- The system should expose enough workload state for an operator to make reasonable decisions before and after triggering work.
- Queue/backpressure behavior should be honest rather than leaving tasks looking generically `pending`.

### Capture the now-invalidated assumption

- Do not assume the OpenClaw plugin should continue to own claim strategy, concurrency heuristics, or queue-state truth.
- Do not assume node-level hints like `compute_intensity` should bind directly to plugin claim behavior before the post-MCP architecture is settled.
- Do not assume the existing task lifecycle (`pending` -> plugin `claimed`) survives unchanged after S12.

## Out of Scope

- Implementing the old plugin-centric S10 design before S12.
- Defining final queue-state names, state machines, or ownership boundaries before the MCP/plugin rethink.
- WebSocket transport upgrade — deferred to S12.1.
- Per-task priority queue or weighted fair scheduling (Phase 2).

## Acceptance Criteria

1. This session is explicitly marked deferred and does not proceed with implementation before S12.2.
2. The docs make clear that the workload-honesty problem remains valid even though the previous solution shape is being discarded.
3. The deferral is tied specifically to the MCP/plugin split, not to a belief that workload honesty is no longer needed.
4. Future design work in S12.2 must revisit where queue semantics, backpressure, and operator visibility belong after the architecture settles.

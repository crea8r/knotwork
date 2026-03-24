# Session 9.2 — OpenClaw Workload Honesty

## Goal

Agents should never silently overload. Knotwork is honest about the queue; the plugin makes intelligent claim decisions; operators can see and reason about agent workload at all times.

## Context

Currently the system creates a task and the plugin claims it when ready. If the plugin is at capacity, the task sits as `pending` indefinitely with no signal back to the operator — it looks identical to "something is broken." There is also no concept of task type affecting how aggressively the plugin should claim work. A research-heavy agent running 5 concurrent tasks is fine; a code-execution agent running 2 concurrent tasks may already be overloaded.

## In Scope

### Knotwork side — honest queue model

- Runs are always accepted and tasks always created; no hard refuse at trigger time.
- Introduce explicit `queued` task state (distinct from `pending`): task exists but agent is at capacity; will be claimed when a slot opens.
- Task state machine: `queued → claimed → completed | failed | escalated`.
- Operator sees queue depth at run trigger: "agent has N tasks running, yours is #M in line."
- Wait-time alerting: if a task has been queued beyond a threshold without being claimed, surface a warning in the run and operator dashboard rather than silently waiting.
- Operator can cancel a queued task without aborting a run in progress.

### Plugin side — intelligent claim decisions

- Node config gains `compute_intensity: light | heavy` hint (set by workflow designer); default `light`.
  - `light`: IO-bound work (LLM calls, web search, drafting) — high idle ratio, safe to run in parallel.
  - `heavy`: compute-bound work (code execution, large file processing, data analysis) — claim only when no other task is running.
- Operator-set `maxConcurrentTasks` ceiling in plugin config (default `2`); plugin never claims above this.
- Adaptive backoff: plugin tracks rolling completion time of recent tasks; if tasks are taking significantly longer than their recent baseline, do not claim new tasks until throughput recovers.
- Memory floor: do not claim if available system memory is below a configurable threshold (default 15% free); memory pressure is a more honest overload signal than CPU for IO-heavy agents.

### Visibility — surface workload state beyond AgentsTab

- **Already done:** AgentsTab running/capacity badge, stall detection, `GET /openclaw/debug-state` endpoint, per-status task counts.
- **Remaining:** operator dashboard shows queue depth and wait-time warnings per agent; run detail page shows explicit state label ("waiting to be claimed", "claimed and running", "stale — no events for N min"); distinction between unclaimed (no plugin online), queued (plugin at capacity), and stale/orphaned is always clear.

## Out of Scope

- WebSocket transport upgrade — S9.4.
- Per-task priority queue or weighted fair scheduling (Phase 2).

## Acceptance Criteria

1. Runs are always accepted; tasks enter explicit `queued` state when agent is at capacity rather than silently sitting in `pending`.
2. Operator sees queue depth at run trigger time and receives a wait-time warning if a task is not claimed within threshold.
3. Operator can cancel a queued task from the run or dashboard without affecting running tasks.
4. Plugin respects `compute_intensity` hint: `heavy` tasks only claimed when no other task is running; `light` tasks claimed up to operator-set cap (default 2).
5. Plugin backs off automatically when rolling task completion time degrades significantly from baseline.
6. Plugin does not claim new tasks when available system memory is below the configured floor.
7. Operator dashboard and run detail show explicit state labels with clear distinction between unclaimed (no plugin online), queued (agent at capacity), and stale/orphaned.

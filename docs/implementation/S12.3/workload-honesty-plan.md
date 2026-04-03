# Historical S10 Execution Plan — OpenClaw Workload Honesty

## Status

This plan is retained as historical design context only.

Do not implement it as written. It assumes the OpenClaw plugin remains a two-way execution/runtime actor that owns queue semantics, claim behavior, and backpressure logic. That assumption is now under reconsideration in S12/S12.1, where MCP becomes the agent -> Knotwork surface and the plugin may be reduced to inbound delivery.

The problem statement still matters: operators need honest workload visibility and the system should not silently overload agents. But the architecture that should own those semantics must be redesigned in S12.2.

## Context

Currently a task enters `"pending"` when created and sits there silently until the plugin claims it.
Operators cannot tell whether the plugin is offline, busy, or ignoring the task.
The plugin has no awareness of task weight — it claims indiscriminately up to `maxConcurrent`.
This plan introduced honest queue semantics, intelligent claim decisions, and the UI labels that surface both to operators. It is now deferred because those responsibilities may no longer belong in the plugin.

---

## Current Status Inventory (baseline for Track A)

### `OpenClawExecutionTask.status` (backend DB)
| Value | Who sets it | Meaning |
|-------|-------------|---------|
| `"pending"` | adapter `openclaw.py:184` on task creation | Waiting to be claimed — reason unknown |
| `"claimed"` | `service.py:615` on plugin pull | Plugin pulled it, assumed executing |
| `"completed"` | `service.py:689` on `completed` event | Clean finish |
| `"failed"` | `service.py:587` (stale 15-min cleanup) OR `service.py:708` (plugin event) | Error — cause conflated |
| `"escalated"` | `service.py:694` on `escalation` event | Plugin needs human input |

### `OpenClawIntegration.status`
`"connected"` | `"disconnected"` (set by stale cleanup at 30 min)

### Plugin `RecentTask.status` (in-memory)
`"claimed"` → `"completed"` | `"escalation"` | `"failed"`

### Event types (plugin → backend)
`"log"` (progress + heartbeats), `"completed"`, `"escalation"`, `"failed"`

### Key problems
1. `"pending"` is triple-duty: no plugin online / plugin at capacity / genuinely waiting
2. `"claimed"` → `"failed"` flip at 15 min is silent — no warning state
3. `"failed"` conflates timeout / plugin error / run cancelled
4. Heartbeat `"log"` events can't be queried separately from real logs for stale detection
5. No `"queued"` state (historical S10 AC #1)

---

## Track A — Backend State Machine

### New statuses on `OpenClawExecutionTask`
| Status | Meaning | Set by |
|--------|---------|--------|
| `"queued"` | Plugin online but at capacity; will claim when slot opens | adapter at creation time (see logic below) |
| `"stale"` | Was `claimed`, adapter heartbeat went quiet >8 min | stale sweep in `plugin_pull_task` |

### New field on `OpenClawExecutionTask`
`failure_reason: str | None` — values: `"timeout"` | `"plugin_error"` | `"run_cancelled"` | `"gateway_error"` | `"operator_cancelled"`

### New event type
`"heartbeat"` — plugin sends this every 15 s instead of a `"log"` event. Enables stale detection via `MAX(created_at) WHERE event_type = "heartbeat"` without log parsing.

### Task creation logic (`openclaw.py` adapter)
At task creation, check `integration.slots_available`:
```python
initial_status = (
    "queued"
    if integration and integration.slots_available is not None and integration.slots_available == 0
    else "pending"
)
```
No new endpoint needed — the integration row already stores `slots_available` from the last pull-task heartbeat.

### pull-task query change (`service.py:plugin_pull_task`)
- Pull both `"pending"` AND `"queued"` tasks (add `"queued"` to the `.in_()` filter at line 607)
- Stale sweep (runs on every pull-task call):
  - `status == "claimed"` AND `updated_at < now - 8 min` AND `updated_at >= now - 15 min` → set to `"stale"`
  - `status in ("claimed", "stale")` AND `updated_at < now - 15 min` → set to `"failed"`, `failure_reason = "timeout"`
- Resume query in adapter (`openclaw.py:163`): add `"queued"` to `.in_(("pending", "claimed", "queued"))`

### Cancel endpoint
`POST /openclaw-plugin/tasks/{task_id}/cancel`
- Auth: workspace membership (operator role)
- Allowed only when `status in ("pending", "queued")`
- Sets `status = "failed"`, `failure_reason = "operator_cancelled"`, `completed_at = now`
- Does NOT touch `Run` or `RunNodeState` — run stays alive

### Queue depth in trigger response
When a run is triggered, the runs service resolves the integration for each OpenClaw node and appends:
```json
{ "queue_depth": 2, "slots_available": 0, "queue_warning": "Agent has 3 tasks queued. Yours is #4." }
```
Added to `RunOut` schema and populated in `runs/service.py:trigger_run`.

### Files changed (Track A)
| File | Change |
|------|--------|
| `backend/knotwork/openclaw_integrations/models.py` | Add `failure_reason: str \| None` column |
| `backend/knotwork/openclaw_integrations/schemas.py` | Add `failure_reason` to `OpenClawTaskDebugItem`; add queue depth fields |
| `backend/knotwork/openclaw_integrations/service.py` | Update stale sweep (8 min → stale / 15 min → failed+timeout), pull-task query, cancel function |
| `backend/knotwork/openclaw_integrations/router.py` | Add `POST /tasks/{task_id}/cancel` endpoint |
| `backend/knotwork/runtime/adapters/openclaw.py` | Check `slots_available` at creation; add `"queued"` to resume query; handle `"stale"` in poll loop |
| `backend/knotwork/runs/schemas.py` | Add `queue_depth`, `queue_warning` to `RunOut` |
| `backend/knotwork/runs/service.py` | Populate queue depth on trigger |
| `backend/alembic/versions/0009_openclaw_workload_honesty.py` | Add `failure_reason` column |
| `plugins/openclaw/src/lifecycle/worker.ts` | Send `event_type: "heartbeat"` every 15 s (replaces heartbeat `"log"`) |

---

## Track B — Plugin Intelligence

### What lives on the Knotwork (backend) side

**`compute_intensity` on node config:**
- Add typed field to `NodeDefSchema` in `graphs/schemas.py`: `compute_intensity: Literal["light", "heavy"] = "light"`
- Stored inside node `config` JSON — no migration needed
- `plugin_pull_task` in `service.py` looks up the node's `compute_intensity` from the graph's definition JSON and includes it in the task payload response

**Claim gate (backend-enforced):**
When plugin reports `tasks_running > 0` AND the next pending task has `compute_intensity = "heavy"`, `plugin_pull_task` skips it and returns `{"task": null}`. This prevents the plugin from needing a "peek then unclaim" dance.

```python
# In plugin_pull_task, after pulling candidate task:
if compute_intensity == "heavy" and tasks_running > 0:
    return {"task": None}  # don't claim — plugin will retry on next poll
```

### What lives on the Plugin side

All three remaining items are purely plugin-side — no backend schema changes needed.

**`maxConcurrentTasks` (already partially implemented):**
- Already read at `plugin.ts:158` via `(cfg as any).maxConcurrentTasks ?? 3`
- Fix: add `maxConcurrentTasks?: number` to the typed `PluginConfig` in `types.ts` and to `getConfig()` in `bridge.ts`
- Already enforced at `timers.ts:45`: `if (activeSpawns.size >= maxConcurrent) return`

**Adaptive backoff:**
- `recentTasks` in `PluginState` already has `startedAt` + `finishedAt` — completion durations are computable
- Add `adaptiveBackoffUntil: string | null` to `PluginState`
- In `worker.ts:runClaimedTask` on task finish: compute `duration = finishedAt - startedAt`; compute rolling baseline from last 5 completed tasks; if current duration > `2× baseline`, set `state.adaptiveBackoffUntil = now + baseline * 2`
- In `timers.ts` poll loop: check `state.adaptiveBackoffUntil` before pulling

**Memory floor:**
- Node.js `os.freemem()` / `os.totalmem()` available natively
- Add `memoryFloorPct?: number` (default 15) to `PluginConfig`
- In `timers.ts` poll loop, before `pullTask`: `if (os.freemem() / os.totalmem() < memoryFloorPct / 100) { log('poll:skip memory-pressure'); return }`

### Files changed (Track B)
| File | Change |
|------|--------|
| `backend/knotwork/graphs/schemas.py` | Add `compute_intensity: Literal["light","heavy"]` to `NodeDefSchema` |
| `backend/knotwork/openclaw_integrations/service.py` | In `plugin_pull_task`: extract `compute_intensity` from node config, apply heavy gate, include in response |
| `frontend/src/types/index.ts` | Add `compute_intensity?: "light" \| "heavy"` to `NodeDef` |
| `plugins/openclaw/src/types.ts` | Add `compute_intensity?` to `ExecutionTask`; `maxConcurrentTasks?` + `memoryFloorPct?` to `PluginConfig`; `adaptiveBackoffUntil` to `PluginState` |
| `plugins/openclaw/src/openclaw/bridge.ts` | Add `maxConcurrentTasks`, `memoryFloorPct` to `getConfig()` return type |
| `plugins/openclaw/src/lifecycle/timers.ts` | Add memory floor check + adaptive backoff check before `pullTask` |
| `plugins/openclaw/src/lifecycle/worker.ts` | Compute duration on finish; update `adaptiveBackoffUntil` if degraded |

---

## Track C — UI Visibility

### Changes driven by Track A

**`AgentsTab.tsx` (`frontend/src/components/settings/AgentsTab.tsx:65–79`)**

Current buckets: `"claimed"` → running, `"failed"`, `"completed"`.

Add:
- `"queued"` bucket → amber "Queued" badge with count
- `"stale"` bucket → orange "Gone quiet" badge
- `failure_reason` shown inline on failed tasks

**`AgentProfilePage.tsx` (line 632)**

Current badge map: `completed→green, failed→red, pending→orange, *→gray`

Add: `queued→amber, stale→orange, claimed→blue`

**Run detail — task state label**

New component `TaskStateLabel` (or inline in `RunDetailHeader.tsx`):

| Task status | Integration status | Label |
|-------------|-------------------|-------|
| `"pending"` | `"disconnected"` | "Waiting — no plugin online" |
| `"pending"` | `"connected"` | "Waiting to be claimed" |
| `"queued"` | any | "Queued — agent at capacity" |
| `"claimed"` | any | "Agent working" |
| `"stale"` | any | "Agent gone quiet" |
| `"escalated"` | any | "Needs your input" |

**Cancel button** on run detail for `"pending"` or `"queued"` tasks (calls `POST /openclaw-plugin/tasks/{id}/cancel`).

**`RunTriggerModal.tsx`**

After trigger API response: if `queue_depth > 0`, show amber banner:
> "Agent has N tasks running. Yours is #M in line."

### Changes driven by Track B

**Node config panel (designer)**
- Add `compute_intensity` selector (radio: Light / Heavy) to node config panel
- Visible for `agent` type nodes with an OpenClaw `agent_ref` only
- Saved into `node.config.compute_intensity`

**`AgentsTab.tsx`**
- Show adaptive backoff state: if `adaptiveBackoffUntil` is set and in the future → orange chip "Backoff active (resumes HH:MM)"
- Memory pressure derived from plugin state via `knotwork.status` RPC

**`SettingsPage.tsx` (plugin config panel)**
- Add `maxConcurrentTasks` (number input, 1–10, default 3)
- Add `memoryFloorPct` (number input, 0–50, default 15)
- Stored in OpenClaw plugin config, not Knotwork DB

### Files changed (Track C)
| File | Change |
|------|--------|
| `frontend/src/components/settings/AgentsTab.tsx` | New status buckets, backoff display |
| `frontend/src/pages/AgentProfilePage.tsx` | Extended badge map |
| `frontend/src/components/operator/RunDetailHeader.tsx` | Task state label + cancel button |
| `frontend/src/components/operator/RunTriggerModal.tsx` | Queue depth warning banner |
| `frontend/src/types/index.ts` | Add `failure_reason`, `"queued"` \| `"stale"` to status unions; `queue_depth` to `Run` |
| `frontend/src/components/designer/` (node config panel) | `compute_intensity` radio selector |
| `frontend/src/pages/SettingsPage.tsx` | `maxConcurrentTasks` + `memoryFloorPct` fields |

---

## Dependency Map

```
Track A (state machine)
  ├── backend-only changes (except heartbeat event type in plugin)
  └── unblocks → Track C: status labels, cancel button, queue depth banner

Track B (plugin intelligence)
  ├── backend: compute_intensity on NodeDef + pull-task claim gate
  ├── plugin: maxConcurrentTasks (type fix), adaptive backoff, memory floor
  └── unblocks → Track C: compute_intensity selector, backoff/memory display

Track C (UI)
  └── purely additive — reads new fields from A and B, no new API contracts
```

Tracks A and B are independent and can be implemented in parallel. Track C should come last (or incrementally per-track).

---

## Session Artifacts

Per project policy (`CLAUDE.md`), after implementation create:
- `docs/implementation/S12.2/workload-honesty-spec.md` — preserved workload-honesty design input
- `docs/implementation/S12.2/workload-honesty-plan.md` — preserved execution-plan draft

---

## Verification Checklist

1. **Track A**: Trigger a run with plugin at capacity → task row shows `"queued"`. Plugin frees a slot → transitions to `"claimed"`.
2. **Track A**: Kill plugin mid-task → after 8 min task shows `"stale"` in debug state; after 15 min shows `"failed"` with `failure_reason="timeout"`.
3. **Track A**: `POST /openclaw-plugin/tasks/{id}/cancel` on a `"queued"` task → 200, run unaffected.
4. **Track B**: Set node `compute_intensity = "heavy"`, plugin has 1 active task → `pull-task` returns `null` even though task is pending.
5. **Track B**: Simulate 5 slow tasks (>2× baseline) → plugin sets `adaptiveBackoffUntil`; `knotwork.status` RPC shows backoff active.
6. **Track B**: Set `memoryFloorPct = 99` → poll loop logs `poll:skip memory-pressure` on every tick.
7. **Track C**: Run trigger modal shows queue warning when `queue_depth > 0`.
8. **Track C**: AgentsTab correctly buckets tasks into queued / stale / running / failed.

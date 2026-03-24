# Activity 03 — Task Poll Loop

The steady-state timer that keeps the plugin connected to Knotwork. Runs on the primary runtime process (the one that holds the lease). Fires every `taskPollIntervalMs` (default: 2 seconds). The timer claims at most one new task per tick, but execution is no longer single-threaded: each claimed task is handed off to a subprocess and multiple tasks may be in flight up to `maxConcurrent`.

See [Activity 04](./task-execution.md) for what happens inside `executeTask`.
See [Activity 06](../knotwork/stale-recovery.md) for how stale tasks are recovered during `pull-task`.
See [Activity 07](./error-recovery.md) for 401 / credential recovery.

---

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Timer as setInterval
    participant Plugin as Plugin (plugin.ts)
    participant KB as Knotwork Backend
    participant Spawn as spawnExecuteTask
    participant Exec as executeTask (session.ts)
    participant FS as Filesystem

    loop every taskPollIntervalMs (default 2000ms)
        Timer->>Plugin: tick

        alt not backgroundWorkerEnabled or no integrationSecret
            Plugin->>Plugin: skip tick
        else ready to poll
            Plugin->>KB: POST /openclaw-plugin/pull-task
            Note right of Plugin: header: X-Knotwork-Integration-Secret
            Note right of Plugin: body includes tasks_running + slots_available

            KB->>KB: resolve_plugin_integration (validate secret, update last_seen_at)
            KB->>KB: scan + auto-fail stale claimed tasks (see Activity 06)

            alt no pending task
                KB-->>Plugin: task: null
                Plugin->>Plugin: log pull:empty
            else pending task found
                KB->>KB: task.status = claimed, claimed_at = now
                KB->>KB: build session_name (_agent_session_name)
                KB-->>Plugin: full task payload (task_id, prompts, session_name, ...)

                Plugin->>Plugin: track runningTasks + recentTasks
                Plugin->>+Spawn: spawnExecuteTask(task)
                Note over Spawn: launches `openclaw gateway call knotwork.execute_task --params ...`
                Spawn->>+Exec: runClaimedTask(task) inside gateway request context
                Note over Exec: see Activity 04 for gateway protocol detail
                Exec->>KB: POST /tasks/{id}/event (log: Plugin started task execution)
                Exec->>Exec: start heartbeat setInterval every 15s
                Note over Exec,KB: heartbeat: POST log event every 15s while executing

                alt result.type == completed
                    Exec->>KB: POST /tasks/{id}/event
                    Note right of Exec: event_type: completed, output, next_branch
                else result.type == escalation
                    Exec->>KB: POST /tasks/{id}/event
                    Note right of Exec: event_type: escalation, questions, options, message
                else result.type == failed or executeTask threw
                    Exec->>KB: POST /tasks/{id}/event
                    Note right of Exec: event_type: failed, error
                end

                alt POST returns 401 from subprocess-less path
                    Note over Exec,KB: credential recovery (see Activity 07), then retry once
                end

                KB->>KB: update task row (status, output, timestamps)
                KB->>KB: INSERT openclaw_execution_events row
                KB-->>Exec: ok
                Exec-->>-Spawn: task complete
                Spawn-->>-Plugin: subprocess exits, running slot released
            end
        end
    end
```

---

## Input

### From poll timer
- `taskPollIntervalMs` from config (default: 2000ms, minimum: 500ms clamped at L635)

Source: [`plugin.ts`](../../../../../../plugins/openclaw/src/plugin.ts)

### From in-memory state
```typescript
state.pluginInstanceId   // required
state.integrationSecret  // required
state.backgroundWorkerEnabled  // must be true
state.runningTasks.length // reported as tasks_running
```

### Task payload returned by backend
```typescript
// types.ts:ExecutionTask
{
  task_id: string
  node_id?: string
  run_id?: string
  workspace_id?: string
  agent_key?: string
  remote_agent_id?: string
  session_name?: string
  system_prompt?: string
  user_prompt?: string
}
```

Source: [`types.ts:ExecutionTask`](../../../../../../plugins/openclaw/src/types.ts#L73), [`service.py:plugin_pull_task L562`](../../../../../../backend/knotwork/openclaw_integrations/service.py#L562)

---

## Output

### Event posted to backend

**On completion:**
```json
{
  "plugin_instance_id": "...",
  "event_type": "completed",
  "payload": { "output": "...", "next_branch": null }
}
```

**On escalation:**
```json
{
  "plugin_instance_id": "...",
  "event_type": "escalation",
  "payload": { "question": "...", "options": ["Approve", "Reject"], "message": "..." }
}
```

**On failure:**
```json
{
  "plugin_instance_id": "...",
  "event_type": "failed",
  "payload": { "error": "..." }
}
```

**Heartbeat (every 15s during execution):**
```json
{
  "event_type": "log",
  "payload": {
    "entry_type": "progress",
    "content": "OpenClaw is still working (heartbeat 3)",
    "metadata": { "heartbeat": 3, "node_id": "...", "run_id": "..." }
  }
}
```

Source: [`lifecycle/worker.ts:pollAndRun`](../../../../../../plugins/openclaw/src/lifecycle/worker.ts), [`openclaw/bridge.ts:postEvent`](../../../../../../plugins/openclaw/src/openclaw/bridge.ts)

---

## Files Read

None directly. Config is already loaded into `state` and `cfg` in memory.

## Files Written

| File | When | What |
|---|---|---|
| `~/.openclaw/knotwork-bridge-state.json` | After every event post + on task finish | Updated `recentTasks`, `runningTaskId`, `lastTaskAt`, `logs` |

Source: [`lifecycle/worker.ts:upsertRecentTask`](../../../../../../plugins/openclaw/src/lifecycle/worker.ts), [`plugin.ts:persistSnapshot`](../../../../../../plugins/openclaw/src/plugin.ts)

## DB Tables Written (backend — during pull-task)

| Table | Operation | Source |
|---|---|---|
| `openclaw_integrations` | UPDATE `last_seen_at` | `service.py:resolve_plugin_integration` (L489) |
| `openclaw_execution_tasks` | UPDATE `status=claimed`, `claimed_at` | `service.py:plugin_pull_task` (L543) |
| `openclaw_execution_tasks` | UPDATE status + result fields | `service.py:plugin_submit_task_event` (L591) |
| `openclaw_execution_events` | INSERT per event | `service.py:plugin_submit_task_event` (L606) |

---

## Concurrency

The current runtime no longer uses a single in-process `busy` flag. The timer continues to fire while prior tasks are running, and each tick reports capacity to Knotwork:

```typescript
setInterval(() => {
  if (!state.backgroundWorkerEnabled || !state.integrationSecret) return
  if (activeSpawns.size >= maxConcurrent) return
  const capacity = {
    tasksRunning: activeSpawns.size,
    slotsAvailable: Math.max(0, maxConcurrent - activeSpawns.size),
  }
  const task = await pullTask(baseUrl, instanceId, secret, capacity)
  if (!task) return
  void spawnExecuteTask(...)
}, pollMs)
```

Each claimed task is then handed to a subprocess (`openclaw gateway call knotwork.execute_task`). That subprocess executes the task inside a gateway request context, which is required for `subagent.run()`. Concurrency is therefore bounded by `maxConcurrent`, not by the poll interval or a single `busy` lock.

---

## Session name format

Built by the backend at `service.py:_agent_session_name` ([L47](../../../../../../backend/knotwork/openclaw_integrations/service.py#L47)):

```
knotwork:<agent-key>:<workspace-id>:run:<run_id>   ← for workflow runs
knotwork:<agent-key>:<workspace-id>:main           ← for main agent chat
knotwork:<agent-key>:<workspace-id>:handbook        ← for handbook sessions
```

The `agent_key` is the `RegisteredAgent.id` UUID if the agent is registered, otherwise the slug portion of `agent_ref` (e.g. `"openclaw:my-agent"` → `"my-agent"`).

Source: [`service.py:plugin_pull_task L548`](../../../../../../backend/knotwork/openclaw_integrations/service.py#L548)

# Runtime Specification — Reliability & Lifecycle

## Parallel Execution

LangGraph executes nodes in parallel when multiple nodes share a common predecessor with direct edges. No special configuration is needed — the graph structure determines parallelism.

```
┌─────────────────┐
│  Contract Intake │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌───────────┐
│ Legal │ │ Financial  │   ← these run in parallel
└───────┘ └───────────┘
    │         │
    └────┬────┘
         │
    ┌────▼────┐
    │ Approval │
    └──────────┘
```

State merging: when parallel branches converge, their outputs are merged into the shared state. If both branches write to the same field, the last-writer-wins (deterministic by execution order within LangGraph).

---

## Checkpointing and Resume

Every node execution is persisted to the PostgreSQL checkpointer after completion. This enables:

**Resume after escalation**: When a human responds to an escalation, the run resumes from the interrupted node with the human's response injected via `Command(resume=human_response)`.

**Replay**: A run can be replayed from any checkpoint by restoring the state at that point and re-executing from that node forward.

**Fault recovery**: If the runtime process crashes mid-run, the run can be resumed from the last completed node on restart.

---

## Error Handling

### Node error (unexpected exception)

```
1. Catch exception
2. Log to RunNodeState (status: failed, error: message)
3. Apply node fail_safe:
   - retry: retry up to retry_limit, then escalate
   - escalate: create escalation immediately
   - skip: mark node skipped, continue to next
   - route: route to the configured fallback node
4. If escalated and timed out: run status → stopped
```

### Distinction: error vs low confidence

| Situation | Cause | Recovery |
|-----------|-------|----------|
| Node error | Exception (API failure, parse error, tool crash) | Retry → escalate |
| Low confidence | LLM completed but is uncertain | Escalate for human review |
| Checkpoint failure | Output does not meet validation rules | Retry with context → escalate |

These are treated differently in the escalation UI: the operator sees a different reason string and different context for each.

---

## Run Lifecycle Management

```python
async def trigger_run(graph_id: str, input: dict, triggered_by: str) -> Run:
    graph = await load_graph(graph_id)
    compiled = get_compiled_graph(graph)

    eta = await estimate_run_time(graph_id)

    run = await create_run(
        graph_id=graph_id,
        graph_version_id=graph.current_version_id,
        input=input,
        trigger=triggered_by,
        eta_seconds=eta,
        status="queued",
    )

    await queue.enqueue("execute_run", run_id=run.id)
    return run

async def execute_run(run_id: str):
    run = await load_run(run_id)
    compiled = get_compiled_graph(run.graph_id)

    config = {"configurable": {"thread_id": run.id}}

    await update_run_status(run.id, "running")

    try:
        async for event in compiled.astream(run.input, config):
            await handle_run_event(run.id, event)

        await update_run_status(run.id, "completed")

    except RunAbortedError:
        await update_run_status(run.id, "stopped")
    except Exception as e:
        await update_run_status(run.id, "failed", error=str(e))
```

---

## ETA Estimation

Run time is estimated from the median duration of the last 20 completed runs of the same graph. If fewer than 3 runs exist, a default estimate based on node count is used (30 seconds per LLM Agent node, 5 seconds per other node type).

The ETA is returned at trigger time and is not updated during the run. It is advisory only.

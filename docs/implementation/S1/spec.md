# Session 1 — Spec

## Goal
Walking skeleton: graph CRUD, trigger run, LLM Agent + Human Checkpoint nodes, dagre canvas, run status polling.

## Deliverables

| Area | File(s) | What it does |
|------|---------|-------------|
| Storage | `knowledge/storage/adapter.py` | Abstract `StorageAdapter` interface |
| Storage | `knowledge/storage/local_fs.py` | `LocalFSAdapter`: read/write/list/delete/history via local filesystem |
| Storage | `knowledge/storage/__init__.py` | `get_storage_adapter()` factory |
| Graphs | `graphs/schemas.py`, `graphs/service.py`, `graphs/router.py` | CRUD: create graph, list, get, save new version |
| Runs | `runs/schemas.py`, `runs/service.py`, `runs/router.py` | Trigger run (enqueue to arq), get status, list |
| Runtime | `runtime/engine.py` | `compile_graph()` (GraphDef → LangGraph), `execute_run()` (drive to completion or pause) |
| Runtime | `runtime/nodes/llm_agent.py` | LLM Agent node: load knowledge tree, build GUIDELINES/CASE prompt, call LLM |
| Runtime | `runtime/nodes/human_checkpoint.py` | Human Checkpoint node: `interrupt()` to pause run |
| Worker | `worker/tasks.py` | arq task `execute_run`, registers all ORM models |
| Frontend | `pages/GraphsPage.tsx` | List graphs, create new graph |
| Frontend | `pages/GraphDetailPage.tsx` | Add nodes, save version, trigger run |
| Frontend | `pages/RunDetailPage.tsx` | Poll run status, show node states, show canvas |
| Frontend | `components/canvas/GraphCanvas.tsx` | Read-only dagre SVG canvas |

## Key design decisions (S1)

- **MemorySaver** checkpointer for now — replaced with `AsyncPostgresSaver` in S2
- **Polling every 2s** while run is active — replaced with WebSocket in S2
- **No auth** on endpoints — all unauthenticated for S1 skeleton
- **Auto-connect nodes** — adding a node auto-creates an edge from the previous last node
- **LangGraph 1.x interrupt**: `ainvoke()` returns `{..., "__interrupt__": [...]}` instead of raising `GraphInterrupt`

## Bugs fixed during S1

1. **`adapter.py` annotation crash** — `list` method inside `StorageAdapter` shadowed the built-in `list`, causing `list[FileVersion]` to raise `TypeError` at class definition time. Fixed with `from __future__ import annotations`.
2. **Worker FK error** — arq worker never imported workspaces/models, so SQLAlchemy couldn't resolve `runs.workspace_id → workspaces.id`. Fixed by adding all model imports to `worker/tasks.py`.
3. **Run never paused** — Engine always set `final_status = "completed"` because LangGraph 1.x surfaces `interrupt()` via `__interrupt__` key in return value, not an exception. Fixed by checking `result.get("__interrupt__")`.

## What S1 does NOT have (planned for S2+)

| Missing | Planned |
|---------|---------|
| JWT auth on endpoints | S2 |
| Resume paused run via UI | S2 |
| WebSocket live updates | S2 |
| Chat designer | S4 |
| Handbook CRUD UI | S3 |
| Escalation inbox | S2 |
| Notifications | S6 |

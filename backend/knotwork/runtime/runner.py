"""
Run execution: execute_run and resume_run.

Extracted from engine.py (S7) to keep that file under the 200-line limit.
All existing imports of execute_run / resume_run from engine.py still work
via re-exports in engine.py.
"""
from __future__ import annotations

import logging
import traceback

logger = logging.getLogger(__name__)


async def _load_run_definition(run_id: str) -> tuple | None:
    from uuid import UUID
    from knotwork.database import AsyncSessionLocal
    from knotwork.graphs.models import GraphVersion
    from knotwork.runs.models import Run

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, UUID(run_id))
        if not run or run.status in ("completed", "failed", "stopped"):
            return None
        version = await db.get(GraphVersion, run.graph_version_id)
        if not version:
            return None
        return (str(run.workspace_id), str(run.graph_id), run.input, run.context_files, version.definition)


async def _update_run_status(
    run_id: str, from_status: str, final_status: str, error: str | None = None
) -> None:
    from datetime import datetime, timezone
    from uuid import UUID
    from knotwork.database import AsyncSessionLocal
    from knotwork.runs.models import Run

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, UUID(run_id))
        if run and run.status not in ("completed", "failed", "stopped"):
            run.status = final_status
            if final_status in ("completed", "failed"):
                run.completed_at = datetime.now(timezone.utc)
            if error:
                run.error = error[:2000]
            await db.commit()


async def execute_run(run_id: str) -> None:
    """Drive a queued run to completion or until interrupted by a checkpoint."""
    from datetime import datetime, timezone
    from uuid import UUID
    from knotwork.database import AsyncSessionLocal
    from knotwork.runs.models import Run
    from knotwork.runtime.engine import compile_graph, _checkpointer
    from knotwork.runtime.events import publish_event

    loaded = await _load_run_definition(run_id)
    if not loaded:
        return
    workspace_id, graph_id, run_input, context_files, definition = loaded

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, UUID(run_id))
        if run:
            run.status = "running"
            run.started_at = datetime.now(timezone.utc)
            await db.commit()

    await publish_event(run_id, {"type": "run_started", "run_id": run_id})

    try:
        async with _checkpointer() as saver:
            graph = compile_graph(definition, checkpointer=saver)
            config = {"configurable": {"thread_id": run_id}}
            result = await graph.ainvoke(
                {"run_id": run_id, "workspace_id": workspace_id, "graph_id": graph_id, "input": run_input,
                 "context_files": context_files, "messages": [], "current_output": None,
                 "node_outputs": {}, "next_branch": None},
                config=config,
            )
        final_status = "paused" if (
            isinstance(result, dict) and result.get("__interrupt__")
        ) else "completed"
    except Exception as exc:
        logger.error("execute_run %s failed:\n%s", run_id, traceback.format_exc())
        final_status = "failed"
        error_msg = f"{type(exc).__name__}: {exc}"
    else:
        error_msg = None

    await _update_run_status(run_id, "running", final_status, error=error_msg)
    await publish_event(run_id, {"type": "run_status_changed", "status": final_status})


async def resume_run(run_id: str, resolution: dict) -> None:
    """Resume a paused run using LangGraph Command(resume=resolution)."""
    from datetime import datetime, timezone
    from uuid import UUID
    from knotwork.database import AsyncSessionLocal
    from knotwork.graphs.models import GraphVersion
    from knotwork.runs.models import Run
    from knotwork.runtime.engine import compile_graph, _checkpointer
    from knotwork.runtime.events import publish_event

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, UUID(run_id))
        if not run or run.status != "paused":
            return
        version = await db.get(GraphVersion, run.graph_version_id)
        if not version:
            return
        # Mark as running before invoke so watchdog fallback does not trigger
        # duplicate resumes while this resume execution is in-flight.
        run.status = "running"
        if run.started_at is None:
            run.started_at = datetime.now(timezone.utc)
        await db.commit()
        definition = version.definition

    try:
        from langgraph.types import Command
        async with _checkpointer() as saver:
            graph = compile_graph(definition, checkpointer=saver)
            config = {"configurable": {"thread_id": run_id}}
            result = await graph.ainvoke(Command(resume=resolution), config=config)
        final_status = "paused" if (
            isinstance(result, dict) and result.get("__interrupt__")
        ) else "completed"
    except Exception as exc:
        logger.error("resume_run %s failed:\n%s", run_id, traceback.format_exc())
        final_status = "failed"
        error_msg = f"{type(exc).__name__}: {exc}"
    else:
        error_msg = None

    await _update_run_status(run_id, "paused", final_status, error=error_msg)
    await publish_event(run_id, {"type": "run_status_changed", "status": final_status})

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
    from libs.database import AsyncSessionLocal
    from modules.workflows.backend.graphs.models import GraphVersion
    from modules.workflows.backend.runs.models import Run

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, run_id)
        if not run or run.status in ("completed", "failed", "stopped"):
            return None
        # Draft runs carry a frozen snapshot — no DB lookup needed
        if run.draft_definition is not None:
            return (
                str(run.workspace_id),
                str(run.project_id) if run.project_id else None,
                str(run.graph_id),
                run.input,
                run.context_files,
                run.draft_definition,
            )
        if run.graph_version_id is None:
            return None
        version = await db.get(GraphVersion, run.graph_version_id)
        if not version:
            return None
        return (
            str(run.workspace_id),
            str(run.project_id) if run.project_id else None,
            str(run.graph_id),
            run.input,
            run.context_files,
            version.definition,
        )


async def _update_run_status(
    run_id: str, from_status: str, final_status: str, error: str | None = None
) -> None:
    from datetime import datetime, timezone
    from libs.database import AsyncSessionLocal
    from core.api import channels as core_channels
    from modules.workflows.backend.runs.models import Run
    from modules.workflows.backend.public_workflows.service import notify_public_run_completion

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, run_id)
        if run and run.status not in ("completed", "failed", "stopped"):
            run.status = final_status
            if final_status in ("completed", "failed"):
                run.completed_at = datetime.now(timezone.utc)
            if error:
                run.error = error[:2000]
            await db.commit()
            if final_status in ("completed", "failed"):
                await core_channels.emit_run_status_event(
                    db,
                    workspace_id=run.workspace_id,
                    run_id=run.id,
                    graph_id=run.graph_id,
                    event_type="run_completed" if final_status == "completed" else "run_failed",
                    subtitle=run.error if final_status == "failed" else None,
                )
            if final_status == "completed":
                await notify_public_run_completion(db, run.id)


async def execute_run(run_id: str) -> None:
    """Drive a queued run to completion or until interrupted by a checkpoint."""
    from datetime import datetime, timezone
    from libs.database import AsyncSessionLocal
    from modules.workflows.backend.runs.models import Run
    from .engine import compile_graph, _checkpointer
    from .events import publish_event

    loaded = await _load_run_definition(run_id)
    if not loaded:
        return
    workspace_id, project_id, graph_id, run_input, context_files, definition = loaded

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, run_id)
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
                {"run_id": run_id, "workspace_id": workspace_id, "project_id": project_id, "graph_id": graph_id, "input": run_input,
                 "context_files": context_files, "messages": [], "current_output": None,
                 "node_outputs": {}, "node_visit_counts": {}, "next_branch": None},
                config=config,
            )
        final_status = "paused" if (
            isinstance(result, dict) and result.get("__interrupt__")
        ) else "completed"
    except Exception as exc:
        # LangGraph interrupt/checkpoint exceptions mean the run paused for
        # human input — treat as "paused", not "failed".
        if type(exc).__name__ in ("GraphInterrupt", "NodeInterrupt", "Interrupt"):
            logger.info("execute_run %s paused via interrupt exception", run_id)
            final_status = "paused"
            error_msg = None
        else:
            logger.error("execute_run %s failed:\n%s", run_id, traceback.format_exc())
            final_status = "failed"
            error_msg = f"{type(exc).__name__}: {exc}"
    else:
        error_msg = None

    if final_status == "completed":
        await _persist_run_output_from_result(run_id, result)
    await _update_run_status(run_id, "running", final_status, error=error_msg)
    await publish_event(run_id, {"type": "run_status_changed", "status": final_status})


async def resume_run(run_id: str, resolution: dict) -> None:
    """Resume a paused run using LangGraph Command(resume=resolution)."""
    from datetime import datetime, timezone
    from libs.database import AsyncSessionLocal
    from modules.workflows.backend.graphs.models import GraphVersion
    from modules.workflows.backend.runs.models import Run
    from .engine import compile_graph, _checkpointer
    from .events import publish_event

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, run_id)
        if not run or run.status != "paused":
            return
        # Mark as running before invoke so watchdog fallback does not trigger
        # duplicate resumes while this resume execution is in-flight.
        run.status = "running"
        if run.started_at is None:
            run.started_at = datetime.now(timezone.utc)
        await db.commit()
        if run.draft_definition is not None:
            definition = run.draft_definition
        else:
            version = await db.get(GraphVersion, run.graph_version_id)
            if not version:
                return
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
        if type(exc).__name__ in ("GraphInterrupt", "NodeInterrupt", "Interrupt"):
            logger.info("resume_run %s paused via interrupt exception", run_id)
            final_status = "paused"
            error_msg = None
        else:
            logger.error("resume_run %s failed:\n%s", run_id, traceback.format_exc())
            final_status = "failed"
            error_msg = f"{type(exc).__name__}: {exc}"
    else:
        error_msg = None

    if final_status == "completed":
        await _persist_run_output_from_result(run_id, result)
    await _update_run_status(run_id, "paused", final_status, error=error_msg)
    await publish_event(run_id, {"type": "run_status_changed", "status": final_status})


def _extract_current_output(result: object) -> str | None:
    if not isinstance(result, dict):
        return None
    value = result.get("current_output")
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


async def _persist_run_output_from_result(
    run_id: str,
    result: object,
    db: "AsyncSession | None" = None,
) -> None:
    from sqlalchemy.ext.asyncio import AsyncSession
    from libs.database import AsyncSessionLocal
    from modules.workflows.backend.runs.models import Run

    final_text = _extract_current_output(result)
    if final_text is None:
        return

    async def _apply(session: AsyncSession) -> None:
        run = await session.get(Run, run_id)
        if run is None:
            return
        run.output = {"text": final_text}
        await session.commit()

    if db is not None:
        await _apply(db)
        return
    async with AsyncSessionLocal() as session:
        await _apply(session)

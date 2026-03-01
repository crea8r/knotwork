"""
Runtime engine: compile GraphDefinition → LangGraph, execute runs.

Uses AsyncPostgresSaver when DATABASE_URL_SYNC is configured (production).
Falls back to MemorySaver otherwise (tests / local dev without Postgres).

NOTE: MemorySaver state is lost between process restarts, so cross-restart
resume only works with AsyncPostgresSaver.
"""

from __future__ import annotations

import logging
import traceback
from contextlib import asynccontextmanager
from operator import add
from typing import TYPE_CHECKING, Annotated, Any, TypeAlias, TypedDict


def _merge_outputs(a: dict, b: dict) -> dict:
    """Reducer: merge per-node output dicts as the run progresses."""
    return {**a, **b}

try:
    from langgraph.graph.state import CompiledStateGraph
    CompiledGraph: TypeAlias = CompiledStateGraph
except ImportError:
    CompiledGraph: TypeAlias = Any  # type: ignore[misc]

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    pass


class RunState(TypedDict):
    run_id: str
    workspace_id: str
    input: dict
    context_files: list
    messages: Annotated[list, add]      # accumulated across nodes
    current_output: str | None
    node_outputs: Annotated[dict, _merge_outputs]  # {node_id: output_text}


@asynccontextmanager
async def _checkpointer():
    """
    Async context manager that yields the best available checkpointer.

    Tries AsyncPostgresSaver (requires DATABASE_URL_SYNC + langgraph-checkpoint-postgres).
    Falls back to MemorySaver.
    """
    from knotwork.config import settings
    url = settings.database_url_sync
    if url:
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # type: ignore[import]
            async with AsyncPostgresSaver.from_conn_string(url) as saver:
                await saver.setup()
                yield saver
                return
        except Exception as exc:
            logger.warning("AsyncPostgresSaver unavailable (%s), using MemorySaver", exc)

    from langgraph.checkpoint.memory import MemorySaver
    yield MemorySaver()


def compile_graph(graph_def: dict, checkpointer: Any = None) -> CompiledGraph:
    """Compile a stored graph definition into a runnable LangGraph object."""
    from langgraph.graph import END, START as LG_START, StateGraph

    from knotwork.runtime.nodes.human_checkpoint import make_human_checkpoint_node
    from knotwork.runtime.nodes.llm_agent import make_llm_agent_node

    if checkpointer is None:
        from langgraph.checkpoint.memory import MemorySaver
        checkpointer = MemorySaver()

    nodes = graph_def.get("nodes", [])
    start_ids = {n["id"] for n in nodes if n.get("type") == "start"}
    end_ids = {n["id"] for n in nodes if n.get("type") == "end"}
    skip_ids = start_ids | end_ids

    workflow = StateGraph(RunState)
    node_ids: set[str] = set()

    for node in nodes:
        nid = node["id"]
        if nid in skip_ids:
            continue
        ntype = node.get("type")
        if ntype == "llm_agent":
            workflow.add_node(nid, make_llm_agent_node(node))
        elif ntype == "human_checkpoint":
            workflow.add_node(nid, make_human_checkpoint_node(node))
        elif ntype == "tool_executor":
            from knotwork.runtime.nodes.tool_executor import make_tool_executor_node
            workflow.add_node(nid, make_tool_executor_node(node))
        else:
            workflow.add_node(nid, lambda s: s)
        node_ids.add(nid)

    for edge in graph_def.get("edges", []):
        src, tgt = edge["source"], edge["target"]
        if src in start_ids:
            if tgt in node_ids:
                workflow.add_edge(LG_START, tgt)
        elif tgt in end_ids:
            if src in node_ids:
                workflow.add_edge(src, END)
        else:
            if src in node_ids and tgt in node_ids:
                workflow.add_edge(src, tgt)
            elif src in node_ids:
                workflow.add_edge(src, END)

    # Legacy graph with no start node — fall back to entry_point
    if not start_ids:
        entry = graph_def.get("entry_point") or (
            nodes[0]["id"] if nodes else None
        )
        if entry and entry in node_ids:
            workflow.set_entry_point(entry)

    return workflow.compile(checkpointer=checkpointer)


async def _load_run_definition(run_id: str) -> tuple | None:
    """Return (run, workspace_id, definition) or None if not found / terminal."""
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
        return (
            str(run.workspace_id),
            run.input,
            run.context_files,
            version.definition,
        )


async def _update_run_status(run_id: str, from_status: str, final_status: str) -> None:
    from datetime import datetime, timezone
    from uuid import UUID

    from knotwork.database import AsyncSessionLocal
    from knotwork.runs.models import Run

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, UUID(run_id))
        if run and run.status == from_status:
            run.status = final_status
            if final_status in ("completed", "failed"):
                run.completed_at = datetime.now(timezone.utc)
            await db.commit()


async def execute_run(run_id: str) -> None:
    """Drive a queued run to completion or until interrupted by a checkpoint."""
    from datetime import datetime, timezone
    from uuid import UUID

    from knotwork.database import AsyncSessionLocal
    from knotwork.runs.models import Run
    from knotwork.runtime.events import publish_event

    loaded = await _load_run_definition(run_id)
    if not loaded:
        return
    workspace_id, run_input, context_files, definition = loaded

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
                {
                    "run_id": run_id,
                    "workspace_id": workspace_id,
                    "input": run_input,
                    "context_files": context_files,
                    "messages": [],
                    "current_output": None,
                    "node_outputs": {},
                },
                config=config,
            )
        final_status = "paused" if (
            isinstance(result, dict) and result.get("__interrupt__")
        ) else "completed"
    except Exception:
        logger.error("execute_run %s failed:\n%s", run_id, traceback.format_exc())
        final_status = "failed"

    await _update_run_status(run_id, "running", final_status)
    await publish_event(run_id, {"type": "run_status_changed", "status": final_status})


async def resume_run(run_id: str, resolution: dict) -> None:
    """Resume a paused run using LangGraph Command(resume=resolution)."""
    from uuid import UUID

    from knotwork.database import AsyncSessionLocal
    from knotwork.graphs.models import GraphVersion
    from knotwork.runs.models import Run
    from knotwork.runtime.events import publish_event

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, UUID(run_id))
        if not run or run.status != "paused":
            return
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
    except Exception:
        logger.error("resume_run %s failed:\n%s", run_id, traceback.format_exc())
        final_status = "failed"

    await _update_run_status(run_id, "paused", final_status)
    await publish_event(run_id, {"type": "run_status_changed", "status": final_status})

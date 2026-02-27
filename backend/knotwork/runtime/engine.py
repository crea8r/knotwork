"""
Runtime engine: compile GraphDefinition → LangGraph, execute runs.

Walking skeleton uses MemorySaver checkpointer (in-process).
Session 2 will switch to AsyncPostgresSaver for durable, resumable state.
"""

from __future__ import annotations

from operator import add
from typing import Annotated, Any, TypeAlias, TypedDict

try:
    from langgraph.graph.state import CompiledStateGraph
    CompiledGraph: TypeAlias = CompiledStateGraph
except ImportError:
    CompiledGraph: TypeAlias = Any  # type: ignore[misc]


class RunState(TypedDict):
    run_id: str
    workspace_id: str
    input: dict
    context_files: list
    messages: Annotated[list, add]  # accumulated across nodes
    current_output: str | None


def compile_graph(graph_def: dict) -> CompiledGraph:
    """Compile a stored graph definition into a runnable LangGraph object."""
    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.graph import END, StateGraph

    from knotwork.runtime.nodes.human_checkpoint import make_human_checkpoint_node
    from knotwork.runtime.nodes.llm_agent import make_llm_agent_node

    workflow = StateGraph(RunState)
    node_ids: set[str] = set()

    for node in graph_def.get("nodes", []):
        nid = node["id"]
        ntype = node.get("type")
        if ntype == "llm_agent":
            workflow.add_node(nid, make_llm_agent_node(node))
        elif ntype == "human_checkpoint":
            workflow.add_node(nid, make_human_checkpoint_node(node))
        else:
            # Stub for conditional_router / tool_executor — pass-through
            workflow.add_node(nid, lambda s: s)
        node_ids.add(nid)

    for edge in graph_def.get("edges", []):
        src, tgt = edge["source"], edge["target"]
        if src in node_ids and tgt in node_ids:
            workflow.add_edge(src, tgt)
        elif src in node_ids:
            workflow.add_edge(src, END)

    entry = graph_def.get("entry_point") or (
        graph_def["nodes"][0]["id"] if graph_def.get("nodes") else None
    )
    if entry:
        workflow.set_entry_point(entry)

    return workflow.compile(checkpointer=MemorySaver())


async def execute_run(run_id: str) -> None:
    """Drive a queued run to completion or until interrupted by a human checkpoint."""
    from datetime import datetime, timezone
    from uuid import UUID

    from knotwork.database import AsyncSessionLocal
    from knotwork.graphs.models import GraphVersion
    from knotwork.runs.models import Run

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, UUID(run_id))
        if not run or run.status in ("completed", "failed", "stopped"):
            return
        version = await db.get(GraphVersion, run.graph_version_id)
        if not version:
            run.status = "failed"
            await db.commit()
            return
        # Snapshot needed values before closing session
        workspace_id = str(run.workspace_id)
        run_input = run.input
        context_files = run.context_files
        definition = version.definition

    # Update status → running
    async with AsyncSessionLocal() as db:
        run = await db.get(Run, UUID(run_id))
        if run:
            run.status = "running"
            run.started_at = datetime.now(timezone.utc)
            await db.commit()

    try:
        graph = compile_graph(definition)
        config = {"configurable": {"thread_id": run_id}}
        await graph.ainvoke(
            {
                "run_id": run_id,
                "workspace_id": workspace_id,
                "input": run_input,
                "context_files": context_files,
                "messages": [],
                "current_output": None,
            },
            config=config,
        )
        final_status = "completed"
    except Exception:
        final_status = "failed"

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, UUID(run_id))
        if run and run.status == "running":
            run.status = final_status
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()

"""
Runtime engine: compile GraphDefinition → LangGraph.

S7: unified dispatch — all non-start/end nodes use make_agent_node().
Legacy types (llm_agent, human_checkpoint, conditional_router) are
auto-converted. tool_executor raises RuntimeError.

Dynamic routing: nodes with >1 outgoing edge use add_conditional_edges
driven by state["next_branch"].

execute_run / resume_run live in runner.py and are re-exported here for
backward compatibility with existing imports.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from operator import add
from typing import Annotated, Any, TypeAlias, TypedDict


def _merge_outputs(a: dict, b: dict) -> dict:
    """Reducer: merge per-node output dicts as the run progresses."""
    return {**a, **b}


try:
    from langgraph.graph.state import CompiledStateGraph
    CompiledGraph: TypeAlias = CompiledStateGraph
except ImportError:
    CompiledGraph: TypeAlias = Any  # type: ignore[misc]

logger = logging.getLogger(__name__)


class RunState(TypedDict):
    run_id: str
    workspace_id: str
    graph_id: str
    input: dict
    context_files: list
    messages: Annotated[list, add]
    current_output: str | None
    node_outputs: Annotated[dict, _merge_outputs]  # {node_id: output_text}
    next_branch: str | None                         # routing hint from agent


@asynccontextmanager
async def _checkpointer():
    """
    Yield AsyncPostgresSaver when possible, else MemorySaver.

    Order:
    1) DATABASE_URL_SYNC (explicit)
    2) Derive from DATABASE_URL when it's Postgres async URL
       (postgresql+asyncpg://... -> postgresql://...)
    3) MemorySaver fallback
    """
    from knotwork.config import settings
    url = settings.database_url_sync
    if not url:
        db_url = settings.database_url
        if db_url.startswith("postgresql+asyncpg://"):
            url = db_url.replace("postgresql+asyncpg://", "postgresql://", 1)
        elif db_url.startswith("postgresql://"):
            url = db_url
    if url:
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # type: ignore[import]
            async with AsyncPostgresSaver.from_conn_string(url) as saver:
                await saver.setup()
                yield saver
                return
        except Exception as exc:
            logger.warning("AsyncPostgresSaver unavailable for URL '%s' (%s), using MemorySaver", url, exc)

    from langgraph.checkpoint.memory import MemorySaver
    yield MemorySaver()


def _make_branch_router(targets: list[str]):
    """Return a routing function that reads state['next_branch'] to select a target."""
    first = targets[0]

    def route(state: RunState) -> str:
        branch = state.get("next_branch")
        return branch if branch in targets else first

    return route


def compile_graph(graph_def: dict, checkpointer: Any = None) -> CompiledGraph:
    """Compile a stored graph definition into a runnable LangGraph object."""
    from langgraph.graph import END, START as LG_START, StateGraph

    from knotwork.runtime.nodes.agent import make_agent_node

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
        if node.get("type") == "tool_executor":
            raise RuntimeError(
                f"Node '{nid}' has type 'tool_executor' which was removed in S7. "
                "Delete this node or replace it with an agent node."
            )
        workflow.add_node(nid, make_agent_node(node))
        node_ids.add(nid)

    # Pre-compute per-source outgoing targets for branch routing
    outgoing: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for edge in graph_def.get("edges", []):
        src, tgt = edge["source"], edge["target"]
        if src in node_ids and tgt in node_ids and tgt not in outgoing.get(src, []):
            outgoing[src].append(tgt)

    for edge in graph_def.get("edges", []):
        src, tgt = edge["source"], edge["target"]
        if src in start_ids:
            if tgt in node_ids:
                workflow.add_edge(LG_START, tgt)
        elif tgt in end_ids:
            if src in node_ids:
                workflow.add_edge(src, END)
        elif src in node_ids and tgt in node_ids:
            targets = outgoing.get(src, [])
            if len(targets) > 1:
                workflow.add_conditional_edges(
                    src, _make_branch_router(targets), {t: t for t in targets},
                )
            else:
                workflow.add_edge(src, tgt)
        elif src in node_ids:
            workflow.add_edge(src, END)

    if not start_ids:  # legacy graph with no start node
        entry = graph_def.get("entry_point") or (nodes[0]["id"] if nodes else None)
        if entry and entry in node_ids:
            workflow.set_entry_point(entry)

    return workflow.compile(checkpointer=checkpointer)


# Re-export for backward compatibility — worker and runs/router import from here
from knotwork.runtime.runner import execute_run, resume_run  # noqa: F401, E402

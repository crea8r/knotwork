"""
Runtime engine: compile GraphDefinition → LangGraph.

All non-start/end nodes use make_agent_node().
Graph definitions are normalized to the unified `agent` node type at load time.

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
    project_id: str | None
    graph_id: str
    input: dict
    context_files: list
    messages: Annotated[list, add]
    current_output: str | None
    node_outputs: Annotated[dict, _merge_outputs]  # {node_id: output_text}
    node_visit_counts: Annotated[dict, _merge_outputs]  # {node_id: visit_count}
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

    NOTE: We deliberately do NOT wrap `yield saver` inside `async with
    AsyncPostgresSaver` because AsyncPostgresSaver.__aexit__ suppresses
    LangGraph's NodeInterrupt/GraphInterrupt exceptions (returns True to
    signal "I handled it").  When an exception is suppressed inside an
    asynccontextmanager generator the generator continues normally and
    Python raises "RuntimeError: generator didn't stop after athrow()".
    Instead we manually __aenter__/__aexit__ the saver and use a plain
    try/finally around the yield so exceptions always propagate cleanly.
    """
    from libs.config import settings
    url = settings.database_url_sync
    if not url:
        db_url = settings.database_url
        if db_url.startswith("postgresql+asyncpg://"):
            url = db_url.replace("postgresql+asyncpg://", "postgresql://", 1)
        elif db_url.startswith("postgresql://"):
            url = db_url
    if url:
        saver_cm = None
        saver = None
        try:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # type: ignore[import]
            saver_cm = AsyncPostgresSaver.from_conn_string(url)
            saver = await saver_cm.__aenter__()
            await saver.setup()
        except Exception as exc:
            if saver_cm is not None:
                try:
                    await saver_cm.__aexit__(None, None, None)
                except Exception:
                    pass
            logger.warning("AsyncPostgresSaver unavailable for URL '%s' (%s), using MemorySaver", url, exc)
            saver = None

        if saver is not None:
            try:
                yield saver
            finally:
                # Close connection without passing exception info — avoids
                # __aexit__ suppressing graph-level exceptions.
                try:
                    await saver_cm.__aexit__(None, None, None)  # type: ignore[union-attr]
                except Exception:
                    pass
            return

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

    from modules.workflows.backend.graphs_schemas import normalize_graph_definition
    from .nodes.agent import make_agent_node

    if checkpointer is None:
        from langgraph.checkpoint.memory import MemorySaver
        checkpointer = MemorySaver()

    graph_def = normalize_graph_definition(graph_def)
    nodes = graph_def.get("nodes", [])
    start_ids = {n["id"] for n in nodes if n.get("type") == "start"}
    end_ids = {n["id"] for n in nodes if n.get("type") == "end"}
    skip_ids = start_ids | end_ids

    workflow = StateGraph(RunState)
    node_ids: set[str] = set()

    # Pre-compute per-source outgoing edges (with condition_label) before building
    # nodes so routing hints can be passed to make_agent_node.
    # Include edges to end nodes — they are valid branch targets for ROUTING and
    # must be represented as conditional edges (not dual direct edges) in LangGraph.
    outgoing: dict[str, list[dict]] = {}
    for edge in graph_def.get("edges", []):
        src, tgt = edge["source"], edge["target"]
        if src in skip_ids:  # never accumulate edges FROM start/end nodes
            continue
        if src not in outgoing:
            outgoing[src] = []
        if not any(e["target"] == tgt for e in outgoing[src]):
            outgoing[src].append({
                "target": tgt,
                "condition_label": edge.get("condition_label") or None,
            })

    for node in nodes:
        nid = node["id"]
        if nid in skip_ids:
            continue
        workflow.add_node(nid, make_agent_node(node, outgoing_edges=outgoing.get(nid, [])))
        node_ids.add(nid)

    # Wire start → entry nodes
    for edge in graph_def.get("edges", []):
        src, tgt = edge["source"], edge["target"]
        if src in start_ids and tgt in node_ids:
            workflow.add_edge(LG_START, tgt)

    # Wire regular nodes — each node is wired exactly once from its outgoing edge list.
    # End-node targets map to LangGraph END in the routing map so the agent can
    # route to them by outputting next_branch = <end_node_id>.
    for nid in node_ids:
        edges_out = outgoing.get(nid, [])
        targets_out = [e["target"] for e in edges_out]
        if len(targets_out) == 0:
            workflow.add_edge(nid, END)
        elif len(targets_out) == 1:
            tgt = targets_out[0]
            workflow.add_edge(nid, tgt if tgt in node_ids else END)
        else:
            # Multi-branch: map end-node IDs to LangGraph END, regular IDs to themselves
            routing_map = {t: t if t in node_ids else END for t in targets_out}
            workflow.add_conditional_edges(
                nid, _make_branch_router(targets_out), routing_map,
            )

    if not start_ids:  # legacy graph with no start node
        entry = graph_def.get("entry_point") or (nodes[0]["id"] if nodes else None)
        if entry and entry in node_ids:
            workflow.set_entry_point(entry)

    return workflow.compile(checkpointer=checkpointer)


# Re-export for backward compatibility — worker and runs/router import from here
from .runner import execute_run, resume_run  # noqa: F401, E402

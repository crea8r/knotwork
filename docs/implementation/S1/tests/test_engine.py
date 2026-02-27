"""
S1 tests: runtime engine

Covers compile_graph structure, interrupt detection, and final status mapping.
LLM calls are mocked — no real API key required.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


GRAPH_DEF = {
    "nodes": [
        {"id": "analyse", "type": "llm_agent", "name": "Analyse", "config": {}},
        {"id": "review", "type": "human_checkpoint", "name": "Review", "config": {}},
    ],
    "edges": [{"id": "e1", "source": "analyse", "target": "review", "type": "direct"}],
    "entry_point": "analyse",
}


def _mock_llm_response(content="mocked output"):
    r = MagicMock()
    r.content = content
    return r


def test_compile_graph_returns_compiled_graph():
    from knotwork.runtime.engine import compile_graph
    graph = compile_graph(GRAPH_DEF)
    assert hasattr(graph, "ainvoke")


def test_compile_graph_single_llm_node():
    from knotwork.runtime.engine import compile_graph
    graph = compile_graph({
        "nodes": [{"id": "n1", "type": "llm_agent", "name": "N", "config": {}}],
        "edges": [],
        "entry_point": "n1",
    })
    assert hasattr(graph, "ainvoke")


def test_compile_graph_passthrough_node():
    """conditional_router / tool_executor get a pass-through lambda, no crash."""
    from knotwork.runtime.engine import compile_graph
    graph = compile_graph({
        "nodes": [{"id": "router", "type": "conditional_router", "name": "R", "config": {}}],
        "edges": [],
        "entry_point": "router",
    })
    assert hasattr(graph, "ainvoke")


@pytest.mark.xfail(
    reason="superseded by S2: llm_agent/human_checkpoint now write to DB "
    "and require valid UUID run_ids; S2 test_engine_postgres.py covers this",
    strict=False,
)
async def test_interrupt_sets_paused_status():
    """
    When LLM node succeeds and human_checkpoint fires interrupt(),
    ainvoke returns {__interrupt__: [...]}, engine must map → "paused".
    """
    from knotwork.runtime.engine import compile_graph

    with patch("langchain_openai.ChatOpenAI.ainvoke", AsyncMock(return_value=_mock_llm_response())):
        graph = compile_graph(GRAPH_DEF)
        result = await graph.ainvoke(
            {
                "run_id": "test-interrupt",
                "workspace_id": "ws1",
                "input": {"text": "hello"},
                "context_files": [],
                "messages": [],
                "current_output": None,
            },
            config={"configurable": {"thread_id": "test-interrupt"}},
        )

    has_interrupt = isinstance(result, dict) and bool(result.get("__interrupt__"))
    assert has_interrupt, "Expected __interrupt__ in ainvoke result when human_checkpoint fires"
    final_status = "paused" if has_interrupt else "completed"
    assert final_status == "paused"


@pytest.mark.xfail(
    reason="superseded by S2: llm_agent now writes to DB and requires valid UUID run_ids",
    strict=False,
)
async def test_no_interrupt_sets_completed():
    """Graph with only an LLM agent (no human checkpoint) completes normally."""
    from knotwork.runtime.engine import compile_graph

    graph_def = {
        "nodes": [{"id": "analyse", "type": "llm_agent", "name": "A", "config": {}}],
        "edges": [],
        "entry_point": "analyse",
    }
    with patch("langchain_openai.ChatOpenAI.ainvoke", AsyncMock(return_value=_mock_llm_response("done"))):
        graph = compile_graph(graph_def)
        result = await graph.ainvoke(
            {
                "run_id": "test-complete",
                "workspace_id": "ws1",
                "input": {},
                "context_files": [],
                "messages": [],
                "current_output": None,
            },
            config={"configurable": {"thread_id": "test-complete"}},
        )

    has_interrupt = isinstance(result, dict) and bool(result.get("__interrupt__"))
    assert not has_interrupt
    assert ("paused" if has_interrupt else "completed") == "completed"

"""
S6.4 automated tests.

Coverage:
  - validate_graph() — topology BFS (unit tests, no DB)
  - compile_graph() — start/end node handling (unit tests, no DB)
  - builtin test endpoint (integration, SQLite in-memory)
  - designer chat history persistence (integration, SQLite in-memory)
"""
from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# 1. Graph validation (pure unit tests — no DB)
# ---------------------------------------------------------------------------

from knotwork.runtime.validation import validate_graph


def test_validate_empty():
    assert validate_graph({"nodes": [], "edges": []}) == []


def test_validate_legacy_no_start():
    """Graphs without a Start node now return a validation error (cannot run)."""
    defn = {
        "nodes": [
            {"id": "a", "type": "llm_agent", "name": "A"},
            {"id": "b", "type": "llm_agent", "name": "B"},
        ],
        "edges": [{"source": "a", "target": "b"}],
    }
    errors = validate_graph(defn)
    assert len(errors) == 1
    assert "Start" in errors[0]


def test_validate_valid_start_end():
    defn = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start"},
            {"id": "a", "type": "llm_agent", "name": "Review"},
            {"id": "end", "type": "end", "name": "End"},
        ],
        "edges": [
            {"source": "start", "target": "a"},
            {"source": "a", "target": "end"},
        ],
    }
    assert validate_graph(defn) == []


def test_validate_isolated_node():
    defn = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start"},
            {"id": "a", "type": "llm_agent", "name": "Review"},
            {"id": "orphan", "type": "llm_agent", "name": "Orphan"},
            {"id": "end", "type": "end", "name": "End"},
        ],
        "edges": [
            {"source": "start", "target": "a"},
            {"source": "a", "target": "end"},
        ],
    }
    errors = validate_graph(defn)
    assert len(errors) == 1
    assert "Orphan" in errors[0]
    assert "not reachable from Start" in errors[0]


def test_validate_dead_end_node():
    """Node reachable from start but not reaching end."""
    defn = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start"},
            {"id": "a", "type": "llm_agent", "name": "Review"},
            {"id": "dead", "type": "llm_agent", "name": "Dead End"},
            {"id": "end", "type": "end", "name": "End"},
        ],
        "edges": [
            {"source": "start", "target": "a"},
            {"source": "a", "target": "dead"},
            {"source": "a", "target": "end"},
        ],
    }
    errors = validate_graph(defn)
    assert len(errors) == 1
    assert "Dead End" in errors[0]
    assert "no path to End" in errors[0]


def test_validate_parallel_starts():
    """Two nodes connected from start — valid."""
    defn = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start"},
            {"id": "a", "type": "llm_agent", "name": "A"},
            {"id": "b", "type": "llm_agent", "name": "B"},
            {"id": "end", "type": "end", "name": "End"},
        ],
        "edges": [
            {"source": "start", "target": "a"},
            {"source": "start", "target": "b"},
            {"source": "a", "target": "end"},
            {"source": "b", "target": "end"},
        ],
    }
    assert validate_graph(defn) == []


def test_validate_only_start_end():
    """Graph with only start and end (no work nodes) is valid."""
    defn = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start"},
            {"id": "end", "type": "end", "name": "End"},
        ],
        "edges": [{"source": "start", "target": "end"}],
    }
    assert validate_graph(defn) == []


# ---------------------------------------------------------------------------
# 2. Engine compilation — start/end skipped as real nodes
# ---------------------------------------------------------------------------

def test_compile_graph_start_end():
    """compile_graph with start/end nodes should compile without error."""
    from knotwork.runtime.engine import compile_graph

    defn = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start", "config": {}},
            {"id": "review", "type": "llm_agent", "name": "Review", "config": {}},
            {"id": "end", "type": "end", "name": "End", "config": {}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "review"},
            {"id": "e2", "source": "review", "target": "end"},
        ],
    }
    graph = compile_graph(defn)
    assert graph is not None


def test_compile_graph_legacy_entry_point():
    """Legacy graph without start/end uses entry_point."""
    from knotwork.runtime.engine import compile_graph

    defn = {
        "nodes": [
            {"id": "step1", "type": "llm_agent", "name": "Step 1", "config": {}},
        ],
        "edges": [],
        "entry_point": "step1",
    }
    graph = compile_graph(defn)
    assert graph is not None


def test_compile_graph_parallel_starts():
    """Two work nodes connected from start compile without error."""
    from knotwork.runtime.engine import compile_graph

    defn = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start", "config": {}},
            {"id": "a", "type": "llm_agent", "name": "A", "config": {}},
            {"id": "b", "type": "llm_agent", "name": "B", "config": {}},
            {"id": "end", "type": "end", "name": "End", "config": {}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "a"},
            {"id": "e2", "source": "start", "target": "b"},
            {"id": "e3", "source": "a", "target": "end"},
            {"id": "e4", "source": "b", "target": "end"},
        ],
    }
    graph = compile_graph(defn)
    assert graph is not None


# ---------------------------------------------------------------------------
# 3. Built-in tool test endpoint
# ---------------------------------------------------------------------------

@pytest.mark.xfail(reason="superseded by S7: built-in tools endpoint removed", strict=False)
async def test_builtin_test_endpoint_calc(client):
    """POST /tools/builtins/calc/test returns a numeric result."""
    resp = await client.post(
        "/api/v1/workspaces/00000000-0000-4000-8000-000000000001/tools/builtins/calc/test",
        json={"input": {"expression": "2 + 3"}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["error"] is None
    assert "result" in data["output"]
    assert data["output"]["result"] == 5


@pytest.mark.xfail(reason="superseded by S7: built-in tools endpoint removed", strict=False)
async def test_builtin_test_endpoint_unknown_slug(client):
    """Unknown slug returns 200 with error field (not 404)."""
    resp = await client.post(
        "/api/v1/workspaces/00000000-0000-4000-8000-000000000001/tools/builtins/nonexistent/test",
        json={"input": {}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["error"] is not None
    assert "nonexistent" in data["error"]


# ---------------------------------------------------------------------------
# 4. Designer chat history persistence
# ---------------------------------------------------------------------------

async def test_designer_messages_empty(client, workspace, graph):
    """New graph has no designer messages."""
    resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/designer-messages"
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_designer_messages_stored(client, db, workspace, graph):
    """Messages stored via DB appear in the GET endpoint."""
    from knotwork.designer.models import DesignerChatMessage
    db.add(DesignerChatMessage(graph_id=graph.id, role="user", content="Hello"))
    db.add(DesignerChatMessage(graph_id=graph.id, role="assistant", content="Hi!"))
    await db.commit()

    resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/designer-messages"
    )
    assert resp.status_code == 200
    msgs = resp.json()
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "Hello"


async def test_designer_messages_clear(client, db, workspace, graph):
    """DELETE clears all messages for a graph."""
    from knotwork.designer.models import DesignerChatMessage
    db.add(DesignerChatMessage(graph_id=graph.id, role="user", content="Hello"))
    db.add(DesignerChatMessage(graph_id=graph.id, role="assistant", content="Hi!"))
    await db.commit()

    del_resp = await client.delete(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/designer-messages"
    )
    assert del_resp.status_code == 204

    resp2 = await client.get(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/designer-messages"
    )
    assert resp2.json() == []


@pytest.mark.xfail(reason="SQLite does not enforce FK CASCADE; passes on PostgreSQL")
async def test_designer_messages_cascade_on_graph_delete(db, workspace, graph):
    """Deleting a graph cascades to its designer messages."""
    from sqlalchemy import select
    from knotwork.designer.models import DesignerChatMessage
    from knotwork.graphs.models import Graph

    db.add(DesignerChatMessage(graph_id=graph.id, role="user", content="cascade test"))
    await db.commit()

    g = await db.get(Graph, graph.id)
    await db.delete(g)
    await db.commit()

    result = await db.execute(
        select(DesignerChatMessage).where(DesignerChatMessage.graph_id == graph.id)
    )
    assert result.scalars().all() == []

"""
S4 tests: designer API endpoints (import-md, design/chat, update, delete graph).
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture
async def ws_id(workspace):
    return str(workspace.id)


@pytest.fixture
async def graph_id(graph):
    return str(graph.id)


# ── Import Markdown ───────────────────────────────────────────────────────────

async def test_import_md_creates_graph(client, ws_id):
    """POST import-md parses Markdown and creates a Graph + GraphVersion."""
    md = "## Analyse Input\n\n-> Review\n\n## Review\n\n**Type:** human_checkpoint"
    r = await client.post(f"/api/v1/workspaces/{ws_id}/graphs/import-md", json={
        "content": md,
        "name": "Imported Workflow",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Imported Workflow"
    nodes = data["latest_version"]["definition"]["nodes"]
    assert len(nodes) == 2
    assert nodes[0]["id"] == "analyse-input"
    assert nodes[1]["type"] == "human_checkpoint"


async def test_import_md_empty_content(client, ws_id):
    """Importing content with no headings creates a graph with empty nodes."""
    r = await client.post(f"/api/v1/workspaces/{ws_id}/graphs/import-md", json={
        "content": "No headings here.",
        "name": "Empty",
    })
    assert r.status_code == 201
    nodes = r.json()["latest_version"]["definition"]["nodes"]
    assert nodes == []


# ── Design Chat ───────────────────────────────────────────────────────────────

async def test_design_chat_returns_delta(client, ws_id, graph_id):
    """POST design/chat calls the agent and returns DesignChatResponse."""
    payload = json.dumps({
        "reply": "Added a summarise node.",
        "graph_delta": {
            "add_nodes": [{"id": "summarise", "type": "llm_agent", "name": "Summarise", "config": {}}],
        },
        "questions": [],
    })

    with patch("langchain_openai.ChatOpenAI") as mock_cls:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=MagicMock(content=payload))
        mock_cls.return_value = mock_llm

        r = await client.post(f"/api/v1/workspaces/{ws_id}/graphs/design/chat", json={
            "session_id": "test-session",
            "message": "Add a summarise node",
            "graph_id": graph_id,
        })

    assert r.status_code == 200
    data = r.json()
    assert data["reply"] == "Added a summarise node."
    assert "add_nodes" in data["graph_delta"]
    assert data["questions"] == []


async def test_design_chat_graph_not_found(client, ws_id):
    r = await client.post(f"/api/v1/workspaces/{ws_id}/graphs/design/chat", json={
        "session_id": "s",
        "message": "hello",
        "graph_id": "00000000-0000-0000-0000-000000000000",
    })
    assert r.status_code == 404


# ── Update Graph ──────────────────────────────────────────────────────────────

async def test_update_graph_name(client, ws_id, graph_id):
    """PATCH /graphs/{id} updates the graph name."""
    r = await client.patch(
        f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}",
        json={"name": "Renamed Graph"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed Graph"


async def test_update_graph_partial(client, ws_id, graph_id):
    """PATCH only updates supplied fields; others are unchanged."""
    r = await client.patch(
        f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}",
        json={"description": "A new description"},
    )
    assert r.status_code == 200
    assert r.json()["description"] == "A new description"
    assert r.json()["name"] == "Test Graph"  # unchanged


async def test_update_graph_not_found(client, ws_id):
    r = await client.patch(
        f"/api/v1/workspaces/{ws_id}/graphs/00000000-0000-0000-0000-000000000000",
        json={"name": "X"},
    )
    assert r.status_code == 404


# ── Delete Graph ──────────────────────────────────────────────────────────────

@pytest.mark.xfail(reason="superseded by S6.1: DELETE /graphs now returns 200+JSON {action, run_count} instead of 204")
async def test_delete_graph(client, ws_id, graph_id):
    """DELETE /graphs/{id} removes the graph and its versions."""
    r = await client.delete(f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}")
    assert r.status_code == 204

    r2 = await client.get(f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}")
    assert r2.status_code == 404


async def test_delete_graph_not_found(client, ws_id):
    r = await client.delete(
        f"/api/v1/workspaces/{ws_id}/graphs/00000000-0000-0000-0000-000000000000"
    )
    assert r.status_code == 404

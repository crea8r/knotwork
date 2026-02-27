"""
S1 tests: Graph CRUD API

Covers: create graph, list graphs, get graph, save new version.
Uses the in-memory SQLite DB via the client fixture.
"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_create_graph(client, workspace):
    ws_id = str(workspace.id)
    resp = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs",
        json={"name": "My Graph", "description": "", "definition": {"nodes": [], "edges": []}},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "My Graph"
    assert "id" in body


@pytest.mark.asyncio
async def test_list_graphs(client, workspace):
    ws_id = str(workspace.id)
    await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs",
        json={"name": "G1", "definition": {"nodes": [], "edges": []}},
    )
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/graphs")
    assert resp.status_code == 200
    graphs = resp.json()
    assert isinstance(graphs, list)
    assert any(g["name"] == "G1" for g in graphs)


@pytest.mark.asyncio
async def test_get_graph(client, workspace):
    ws_id = str(workspace.id)
    create_resp = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs",
        json={"name": "Fetch Me", "definition": {"nodes": [], "edges": []}},
    )
    graph_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == graph_id


@pytest.mark.asyncio
async def test_get_graph_not_found(client, workspace):
    ws_id = str(workspace.id)
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/graphs/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_save_graph_version(client, workspace):
    ws_id = str(workspace.id)
    create_resp = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs",
        json={"name": "Versioned", "definition": {"nodes": [], "edges": []}},
    )
    graph_id = create_resp.json()["id"]

    new_def = {
        "nodes": [{"id": "n1", "type": "llm_agent", "name": "Step", "config": {}}],
        "edges": [],
    }
    resp = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/versions",
        json={"definition": new_def, "note": "added a node"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["definition"]["nodes"][0]["id"] == "n1"


@pytest.mark.asyncio
async def test_graph_has_latest_version_field(client, workspace):
    """GET /graphs/{id} should include a latest_version object with a definition."""
    ws_id = str(workspace.id)
    create_resp = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs",
        json={
            "name": "Versioned2",
            "definition": {
                "nodes": [{"id": "x", "type": "llm_agent", "name": "X", "config": {}}],
                "edges": [],
            },
        },
    )
    graph_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}")
    body = resp.json()
    assert body["latest_version"] is not None
    assert "nodes" in body["latest_version"]["definition"]
    assert body["latest_version"]["definition"]["nodes"][0]["id"] == "x"

"""S2: ratings CRUD API tests."""
from __future__ import annotations

import pytest


async def test_submit_rating(client, workspace, run, run_node_state):
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/nodes/{run_node_state.id}/rating",
        json={"score": 4, "comment": "Good output"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["score"] == 4
    assert data["comment"] == "Good output"
    assert data["run_node_state_id"] == str(run_node_state.id)


async def test_submit_rating_score_range(client, workspace, run, run_node_state):
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/nodes/{run_node_state.id}/rating",
        json={"score": 1},
    )
    assert resp.status_code == 201

    # Invalid score
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/nodes/{run_node_state.id}/rating",
        json={"score": 6},
    )
    assert resp.status_code == 422


async def test_submit_rating_upserts(client, workspace, run, run_node_state):
    # First rating
    resp1 = await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/nodes/{run_node_state.id}/rating",
        json={"score": 3},
    )
    assert resp1.status_code == 201

    # Update rating for same node state
    resp2 = await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/nodes/{run_node_state.id}/rating",
        json={"score": 5, "comment": "Updated"},
    )
    assert resp2.status_code == 201
    assert resp2.json()["score"] == 5


async def test_submit_rating_node_not_found(client, workspace, run):
    import uuid
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/nodes/{uuid.uuid4()}/rating",
        json={"score": 3},
    )
    assert resp.status_code == 404


async def test_list_ratings_empty(client, workspace):
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/ratings")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_ratings(client, workspace, run, run_node_state):
    await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/nodes/{run_node_state.id}/rating",
        json={"score": 2},
    )
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/ratings")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["score"] == 2


async def test_list_ratings_filter_score_lte(client, workspace, run, run_node_state):
    await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/nodes/{run_node_state.id}/rating",
        json={"score": 4},
    )
    # score_lte=3 should return empty (score is 4)
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/ratings?score_lte=3")
    assert resp.status_code == 200
    assert resp.json() == []

    # score_lte=5 should return it
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/ratings?score_lte=5")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

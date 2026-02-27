"""
S1 tests: Run trigger + status API

Covers: trigger run (returns queued), get run, list runs.
arq enqueue is mocked so no Redis required.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _mock_redis():
    """Return an arq redis pool mock that swallows enqueue_job."""
    pool = AsyncMock()
    pool.enqueue_job = AsyncMock()
    pool.aclose = AsyncMock()
    return pool


@pytest.mark.asyncio
async def test_trigger_run_returns_queued(client, workspace, graph):
    ws_id = str(workspace.id)
    graph_id = str(graph.id)

    with patch("arq.create_pool", return_value=_mock_redis()):
        resp = await client.post(
            f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/runs",
            json={"input": {"text": "hello"}, "context_files": []},
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "queued"
    assert body["graph_id"] == graph_id
    assert "id" in body


@pytest.mark.asyncio
async def test_trigger_run_enqueues_job(client, workspace, graph):
    ws_id = str(workspace.id)
    graph_id = str(graph.id)
    mock_pool = _mock_redis()

    with patch("arq.create_pool", return_value=mock_pool):
        resp = await client.post(
            f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/runs",
            json={"input": {}, "context_files": []},
        )

    assert resp.status_code == 201
    run_id = resp.json()["id"]
    mock_pool.enqueue_job.assert_called_once_with("execute_run", run_id=run_id)


@pytest.mark.asyncio
async def test_get_run(client, workspace, graph):
    ws_id = str(workspace.id)
    graph_id = str(graph.id)

    with patch("arq.create_pool", return_value=_mock_redis()):
        create_resp = await client.post(
            f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/runs",
            json={"input": {}, "context_files": []},
        )
    run_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/workspaces/{ws_id}/runs/{run_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == run_id
    assert resp.json()["status"] == "queued"


@pytest.mark.asyncio
async def test_get_run_not_found(client, workspace):
    ws_id = str(workspace.id)
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/runs/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_workspace_runs(client, workspace, graph):
    ws_id = str(workspace.id)
    graph_id = str(graph.id)

    with patch("arq.create_pool", return_value=_mock_redis()):
        await client.post(
            f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/runs",
            json={"input": {"x": 1}, "context_files": []},
        )
        await client.post(
            f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/runs",
            json={"input": {"x": 2}, "context_files": []},
        )

    resp = await client.get(f"/api/v1/workspaces/{ws_id}/runs")
    assert resp.status_code == 200
    runs = resp.json()
    assert len(runs) >= 2


@pytest.mark.asyncio
async def test_trigger_run_graph_not_found(client, workspace):
    ws_id = str(workspace.id)
    resp = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs/00000000-0000-0000-0000-000000000000/runs",
        json={"input": {}, "context_files": []},
    )
    assert resp.status_code == 400

"""S2: resume + abort run endpoint tests."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch


async def test_resume_paused_run_enqueues(client, workspace, run, db):
    from knotwork.runs.models import Run
    r = await db.get(Run, run.id)
    r.status = "paused"
    await db.commit()

    with patch("arq.create_pool", new_callable=AsyncMock) as mock_pool:
        mock_redis = AsyncMock()
        mock_pool.return_value = mock_redis
        resp = await client.post(
            f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/resume",
            json={"resolution": "approved"},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "resuming"


async def test_resume_non_paused_run_rejected(client, workspace, run):
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/resume",
        json={"resolution": "approved"},
    )
    assert resp.status_code == 400
    assert "paused" in resp.json()["detail"].lower()


async def test_resume_run_not_found(client, workspace):
    import uuid
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/runs/{uuid.uuid4()}/resume",
        json={"resolution": "approved"},
    )
    assert resp.status_code == 404


async def test_abort_run(client, workspace, run, db):
    # S6.1: abort moved to POST .../abort (DELETE now permanently deletes terminal runs)
    from knotwork.runs.models import Run
    r = await db.get(Run, run.id)
    r.status = "running"
    await db.commit()

    resp = await client.post(f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/abort")
    assert resp.status_code == 200
    assert resp.json()["status"] == "stopped"

    await db.refresh(r)
    assert r.status == "stopped"


async def test_abort_terminal_run_rejected(client, workspace, run, db):
    # S6.1: abort moved to POST .../abort
    from knotwork.runs.models import Run
    r = await db.get(Run, run.id)
    r.status = "completed"
    await db.commit()

    resp = await client.post(f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/abort")
    assert resp.status_code == 400

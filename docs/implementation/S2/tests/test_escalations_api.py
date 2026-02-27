"""S2: escalation CRUD + resolution API tests."""
from __future__ import annotations

import pytest


@pytest.fixture
async def escalation(db, workspace, run, run_node_state):
    from knotwork.escalations.service import create_escalation
    return await create_escalation(
        db,
        run_id=run.id,
        run_node_state_id=run_node_state.id,
        workspace_id=workspace.id,
        type="human_checkpoint",
        context={"prompt": "Please review.", "current_output": "test output"},
        timeout_hours=24,
    )


async def test_list_escalations_empty(client, workspace):
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/escalations")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_escalations(client, workspace, escalation):
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/escalations")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == str(escalation.id)
    assert data[0]["status"] == "open"


async def test_list_escalations_filter_open(client, workspace, escalation):
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/escalations?status=open")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_list_escalations_filter_resolved_empty(client, workspace, escalation):
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/escalations?status=resolved")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_escalation(client, workspace, escalation):
    resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/escalations/{escalation.id}"
    )
    assert resp.status_code == 200
    assert resp.json()["type"] == "human_checkpoint"


async def test_get_escalation_not_found(client, workspace):
    import uuid
    resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/escalations/{uuid.uuid4()}"
    )
    assert resp.status_code == 404


async def test_resolve_approved(client, workspace, escalation):
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/escalations/{escalation.id}/resolve",
        json={"resolution": "approved"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "resolved"
    assert data["resolution"] == "approved"


async def test_resolve_edited(client, workspace, escalation):
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/escalations/{escalation.id}/resolve",
        json={"resolution": "edited", "edited_output": {"text": "corrected output"}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["resolution"] == "edited"
    assert data["resolution_data"]["edited_output"] == {"text": "corrected output"}


async def test_resolve_guided(client, workspace, escalation):
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/escalations/{escalation.id}/resolve",
        json={"resolution": "guided", "guidance": "Be more concise."},
    )
    assert resp.status_code == 200
    assert resp.json()["resolution"] == "guided"


async def test_resolve_aborted(client, workspace, escalation, run, db):
    # Set run to paused first
    from knotwork.runs.models import Run
    r = await db.get(Run, run.id)
    r.status = "paused"
    await db.commit()

    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/escalations/{escalation.id}/resolve",
        json={"resolution": "aborted"},
    )
    assert resp.status_code == 200
    assert resp.json()["resolution"] == "aborted"

    # Run should be stopped
    await db.refresh(r)
    assert r.status == "stopped"


async def test_resolve_already_resolved(client, workspace, escalation):
    # First resolve
    await client.post(
        f"/api/v1/workspaces/{workspace.id}/escalations/{escalation.id}/resolve",
        json={"resolution": "approved"},
    )
    # Second resolve should fail
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/escalations/{escalation.id}/resolve",
        json={"resolution": "approved"},
    )
    assert resp.status_code == 400

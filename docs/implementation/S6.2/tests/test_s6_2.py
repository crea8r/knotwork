"""
S6.2 automated tests: run naming, enriched list, delete policy, graph version endpoint.
Uses SQLite in-memory — no live services needed.
"""
from __future__ import annotations
import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

from knotwork.main import app
from knotwork.database import Base, get_db

# ── DB fixture ──────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="function")
async def db_session():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession):
    async def override():
        yield db_session
    app.dependency_overrides[get_db] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


# ── helpers ──────────────────────────────────────────────────────────────────

async def _setup(client: AsyncClient) -> dict:
    ws_id = str(uuid.uuid4())
    # Create workspace directly in DB to avoid auth deps
    from knotwork.database import get_db as _gdb
    # Use the DB session via client fixture's override
    g = await client.post(f"/api/v1/workspaces/{ws_id}/graphs", json={"name": "Test Graph"})
    assert g.status_code == 201, g.text
    graph_id = g.json()["id"]
    v = await client.post(
        f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/versions",
        json={"definition": {"nodes": [{"id": "n1", "type": "llm_agent", "name": "N1", "config": {}}], "edges": []}},
    )
    assert v.status_code == 201
    return {"ws_id": ws_id, "graph_id": graph_id}


async def _create_run(client: AsyncClient, ws_id: str, graph_id: str, **kwargs) -> str:
    payload = {"input": {"q": "hello"}, **kwargs}
    r = await client.post(f"/api/v1/workspaces/{ws_id}/graphs/{graph_id}/runs", json=payload)
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ── tests ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_create_with_name(client):
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"], name="My test run")
    r = await client.get(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}")
    assert r.status_code == 200
    assert r.json()["name"] == "My test run"


@pytest.mark.asyncio
async def test_run_create_without_name(client):
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])
    r = await client.get(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}")
    assert r.status_code == 200
    assert r.json()["name"] is None


@pytest.mark.asyncio
async def test_run_rename(client):
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])

    r = await client.patch(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}", json={"name": "Renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"

    # Verify persisted
    r2 = await client.get(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}")
    assert r2.json()["name"] == "Renamed"


@pytest.mark.asyncio
async def test_rename_nonexistent_run_404(client):
    s = await _setup(client)
    r = await client.patch(
        f"/api/v1/workspaces/{s['ws_id']}/runs/{uuid.uuid4()}",
        json={"name": "X"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_runs_includes_enriched_fields(client):
    s = await _setup(client)
    await _create_run(client, s["ws_id"], s["graph_id"], name="Enriched run")

    r = await client.get(f"/api/v1/workspaces/{s['ws_id']}/runs")
    assert r.status_code == 200
    runs = r.json()
    assert len(runs) == 1
    run = runs[0]
    assert "total_tokens" in run
    assert "output_summary" in run
    assert "needs_attention" in run
    assert run["name"] == "Enriched run"
    assert run["needs_attention"] is False  # queued, not paused


@pytest.mark.asyncio
async def test_delete_queued_run(client):
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])

    r = await client.delete(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}")
    assert r.status_code == 204

    r2 = await client.get(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}")
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_delete_running_run_rejected(client, db_session):
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])

    # Force to running
    from knotwork.runs.models import Run
    from uuid import UUID
    run = await db_session.get(Run, UUID(run_id))
    run.status = "running"
    await db_session.commit()

    r = await client.delete(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}")
    assert r.status_code == 400
    assert "running" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_paused_run(client, db_session):
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])

    from knotwork.runs.models import Run
    from uuid import UUID
    run = await db_session.get(Run, UUID(run_id))
    run.status = "paused"
    await db_session.commit()

    r = await client.delete(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_graph_version_endpoint(client):
    s = await _setup(client)
    # Get the graph to find the version_id
    g = await client.get(f"/api/v1/workspaces/{s['ws_id']}/graphs/{s['graph_id']}")
    version_id = g.json()["latest_version"]["id"]

    r = await client.get(f"/api/v1/workspaces/{s['ws_id']}/graphs/versions/{version_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == version_id
    assert "definition" in data


@pytest.mark.asyncio
async def test_graph_version_wrong_workspace_404(client):
    s = await _setup(client)
    g = await client.get(f"/api/v1/workspaces/{s['ws_id']}/graphs/{s['graph_id']}")
    version_id = g.json()["latest_version"]["id"]

    r = await client.get(f"/api/v1/workspaces/{uuid.uuid4()}/graphs/versions/{version_id}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_run_out_has_graph_version_id(client):
    s = await _setup(client)
    run_id = await _create_run(client, s["ws_id"], s["graph_id"])
    r = await client.get(f"/api/v1/workspaces/{s['ws_id']}/runs/{run_id}")
    assert r.status_code == 200
    assert "graph_version_id" in r.json()
    assert r.json()["graph_version_id"] is not None

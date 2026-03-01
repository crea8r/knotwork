"""
S5 backend tests — runs list endpoint (used by Dashboard + RunsPage).
SQLite in-memory, no live services needed.
"""
from __future__ import annotations

import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake-key-for-tests")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("DATABASE_URL_SYNC", "")

import knotwork.auth.models         # noqa: F401
import knotwork.workspaces.models   # noqa: F401
import knotwork.graphs.models       # noqa: F401
import knotwork.runs.models         # noqa: F401
import knotwork.knowledge.models    # noqa: F401
import knotwork.tools.models        # noqa: F401
import knotwork.escalations.models  # noqa: F401
import knotwork.ratings.models      # noqa: F401
import knotwork.audit.models        # noqa: F401

from knotwork.database import Base, get_db
from knotwork.main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def engine():
    eng = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
async def client(engine):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    import knotwork.knowledge.service as svc_mod
    import knotwork.knowledge.router as router_mod
    import knotwork.knowledge.suggestions as sugg_mod
    from knotwork.knowledge.storage.local_fs import LocalFSAdapter
    import tempfile, pathlib
    tmp = LocalFSAdapter(root=str(pathlib.Path(tempfile.mkdtemp())))
    lam = lambda: tmp  # noqa: E731
    orig = (svc_mod.get_storage_adapter, router_mod.get_storage_adapter, sugg_mod.get_storage_adapter)
    svc_mod.get_storage_adapter = lam
    router_mod.get_storage_adapter = lam
    sugg_mod.get_storage_adapter = lam

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

    app.dependency_overrides.clear()
    svc_mod.get_storage_adapter, router_mod.get_storage_adapter, sugg_mod.get_storage_adapter = orig


@pytest.fixture
async def workspace(client):
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    eng = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    # Use existing engine from DB via dependency override; create workspace directly
    # We call the workspaces API or insert directly. Here we insert directly.
    from knotwork.workspaces.models import Workspace
    # Get session from overridden dependency
    factory = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
    # Actually, reuse the engine fixture by just creating workspace via API-less direct insert
    # Simpler: use the client fixture's engine (it's shared via override)
    # We'll create workspace through the DB override by posting to a helper
    # Cleanest: just create workspace model directly using the engine
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)() as session:
        ws = Workspace(name="Test WS", slug="test-ws-s5")
        session.add(ws)
        await session.commit()
        await session.refresh(ws)
        yield ws
    await eng.dispose()


# ─── Simpler approach: create all objects via direct DB in a single fixture ────

@pytest.fixture
async def setup(engine):
    """Creates workspace + graph + version in the test DB."""
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    from knotwork.workspaces.models import Workspace
    from knotwork.graphs.models import Graph, GraphVersion

    async with factory() as db:
        ws = Workspace(name="Test WS", slug="test-ws-s5-b")
        db.add(ws)
        await db.flush()

        g = Graph(workspace_id=ws.id, name="Test Graph")
        db.add(g)
        await db.flush()

        v = GraphVersion(
            graph_id=g.id,
            definition={"nodes": [{"id": "n1", "type": "llm_agent", "name": "N", "config": {}}],
                        "edges": [], "entry_point": "n1"},
        )
        db.add(v)
        await db.commit()
        await db.refresh(ws)
        await db.refresh(g)
        return {"workspace_id": str(ws.id), "graph_id": str(g.id), "version_id": str(v.id)}


@pytest.mark.asyncio
async def test_list_workspace_runs_empty(client, setup):
    """GET /workspaces/{ws}/runs returns [] for a fresh workspace."""
    ws_id = setup["workspace_id"]
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/runs")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_workspace_runs_after_trigger(client, setup, engine):
    """After inserting a run, it appears in the list with correct fields."""
    from knotwork.runs.models import Run
    import uuid

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        run = Run(
            workspace_id=uuid.UUID(setup["workspace_id"]),
            graph_id=uuid.UUID(setup["graph_id"]),
            graph_version_id=uuid.UUID(setup["version_id"]),
            status="completed",
            input={"task": "hello"},
        )
        db.add(run)
        await db.commit()
        run_id = str(run.id)

    ws_id = setup["workspace_id"]
    resp = await client.get(f"/api/v1/workspaces/{ws_id}/runs")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    r = data[0]
    assert r["id"] == run_id
    assert r["status"] == "completed"
    assert r["graph_id"] == setup["graph_id"]
    assert "created_at" in r
    assert "input" in r


@pytest.mark.asyncio
async def test_dashboard_data_shape(client, setup, engine):
    """Runs + escalations queries return expected shapes for dashboard."""
    from knotwork.runs.models import Run
    from knotwork.escalations.models import Escalation
    import uuid

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    ws_id = uuid.UUID(setup["workspace_id"])
    graph_id = uuid.UUID(setup["graph_id"])
    version_id = uuid.UUID(setup["version_id"])

    async with factory() as db:
        last_run = None
        for status in ("running", "completed", "failed"):
            run = Run(
                workspace_id=ws_id, graph_id=graph_id,
                graph_version_id=version_id,
                status=status, input={},
            )
            db.add(run)
            last_run = run
        await db.flush()

        # Escalation requires a run_node_state_id (not nullable)
        from knotwork.runs.models import RunNodeState
        rns = RunNodeState(run_id=last_run.id, node_id="n1", status="completed")
        db.add(rns)
        await db.flush()

        esc = Escalation(
            workspace_id=ws_id,
            run_id=last_run.id,
            run_node_state_id=rns.id,
            type="low_confidence",
            status="open",
            context={"node_id": "n1", "confidence": 0.4},
        )
        db.add(esc)
        await db.commit()

    runs_resp = await client.get(f"/api/v1/workspaces/{setup['workspace_id']}/runs")
    assert runs_resp.status_code == 200
    runs = runs_resp.json()
    statuses = {r["status"] for r in runs}
    assert "running" in statuses
    assert "completed" in statuses

    esc_resp = await client.get(
        f"/api/v1/workspaces/{setup['workspace_id']}/escalations?status=open"
    )
    assert esc_resp.status_code == 200
    escs = esc_resp.json()
    assert len(escs) >= 1
    assert escs[0]["status"] == "open"
    assert "type" in escs[0]
    assert "run_id" in escs[0]

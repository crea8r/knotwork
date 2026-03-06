"""
Shared fixtures for S6.5 tests.

Uses SQLite in-memory so tests run without a live Postgres instance.
"""
from __future__ import annotations

import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake-key-for-tests")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "s6-5-test-secret")

# Register all models
import knotwork.auth.models          # noqa: F401
import knotwork.workspaces.models    # noqa: F401
import knotwork.graphs.models        # noqa: F401
import knotwork.runs.models          # noqa: F401
import knotwork.knowledge.models     # noqa: F401
import knotwork.tools.models         # noqa: F401
import knotwork.escalations.models   # noqa: F401
import knotwork.ratings.models       # noqa: F401
import knotwork.audit.models         # noqa: F401
import knotwork.notifications.models # noqa: F401
import knotwork.designer.models      # noqa: F401

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
async def db(engine):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest.fixture
async def client(engine):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with factory() as session:
            yield session

    # Override AsyncSessionLocal used inside agent_api router too
    import knotwork.database as _db_module
    original_local = _db_module.AsyncSessionLocal
    _db_module.AsyncSessionLocal = factory  # type: ignore[assignment]

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    _db_module.AsyncSessionLocal = original_local


@pytest.fixture
async def workspace(db):
    from knotwork.workspaces.models import Workspace
    ws = Workspace(name="Test Workspace", slug="test-workspace")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


@pytest.fixture
async def graph(db, workspace):
    from knotwork.graphs.models import Graph, GraphVersion
    g = Graph(workspace_id=workspace.id, name="Test Graph")
    db.add(g)
    await db.flush()
    v = GraphVersion(
        graph_id=g.id,
        definition={
            "nodes": [
                {"id": "start", "type": "start", "name": "Start", "config": {}},
                {"id": "analyse", "type": "llm_agent", "name": "Analyse", "config": {}},
                {"id": "end", "type": "end", "name": "End", "config": {}},
            ],
            "edges": [
                {"id": "e0", "source": "start", "target": "analyse", "type": "direct"},
                {"id": "e1", "source": "analyse", "target": "end", "type": "direct"},
            ],
        },
    )
    db.add(v)
    await db.commit()
    await db.refresh(g)
    return g


@pytest.fixture
async def run(db, workspace, graph):
    """A queued run (no worker needed for API tests)."""
    from knotwork.graphs.models import GraphVersion
    from knotwork.runs.models import Run
    from sqlalchemy import select

    v_q = await db.execute(select(GraphVersion).where(GraphVersion.graph_id == graph.id))
    version = v_q.scalar_one()

    r = Run(
        workspace_id=workspace.id,
        graph_id=graph.id,
        graph_version_id=version.id,
        input={"task": "test"},
        context_files=[],
        status="running",
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


@pytest.fixture
async def node_state(db, run):
    """An active RunNodeState for the 'analyse' node."""
    from datetime import datetime, timezone
    from knotwork.runs.models import RunNodeState

    ns = RunNodeState(
        run_id=run.id,
        node_id="analyse",
        node_name="Analyse",
        agent_ref="openai:gpt-4o",
        status="running",
        input={"model": "openai/gpt-4o"},
        started_at=datetime.now(timezone.utc),
    )
    db.add(ns)
    await db.commit()
    await db.refresh(ns)
    return ns

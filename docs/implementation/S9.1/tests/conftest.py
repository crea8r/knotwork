"""
Shared fixtures for S9.1 tests.
Uses SQLite in-memory — no live Postgres or Redis needed.
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

# Register all models
import knotwork.auth.models              # noqa: F401
import knotwork.workspaces.models        # noqa: F401
import knotwork.graphs.models            # noqa: F401
import knotwork.runs.models              # noqa: F401
import knotwork.knowledge.models         # noqa: F401
import knotwork.tools.models             # noqa: F401
import knotwork.escalations.models       # noqa: F401
import knotwork.ratings.models           # noqa: F401
import knotwork.audit.models             # noqa: F401

from knotwork.database import Base, get_db
from knotwork.main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

SIMPLE_DEFINITION = {
    "nodes": [
        {"id": "start", "type": "start", "name": "Start", "config": {}},
        {"id": "work", "type": "agent", "name": "Work", "config": {}},
        {"id": "end", "type": "end", "name": "End", "config": {}},
    ],
    "edges": [
        {"id": "e0", "source": "start", "target": "work", "type": "direct"},
        {"id": "e1", "source": "work", "target": "end", "type": "direct"},
    ],
    "entry_point": "work",
}


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

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def workspace(db):
    from knotwork.workspaces.models import Workspace
    ws = Workspace(name="Test Workspace", slug="test-ws-s91")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


@pytest.fixture
async def graph(db, workspace):
    """A new workflow — starts with a bare root draft (no version)."""
    from knotwork.graphs.schemas import GraphCreate, GraphDefinitionSchema
    from knotwork.graphs.service import create_graph
    data = GraphCreate(
        name="Test Workflow",
        definition=GraphDefinitionSchema.model_validate(SIMPLE_DEFINITION),
    )
    return await create_graph(db, workspace.id, data)

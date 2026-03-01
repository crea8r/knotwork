"""Shared fixtures for S6.4 tests."""
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

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def workspace(db):
    from knotwork.workspaces.models import Workspace
    ws = Workspace(name="Test Workspace", slug="test-ws-s64")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


@pytest.fixture
async def graph(db, workspace):
    from knotwork.graphs.models import Graph
    g = Graph(workspace_id=workspace.id, name="Test Graph")
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return g

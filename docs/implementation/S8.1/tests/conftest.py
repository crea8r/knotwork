"""
Shared fixtures for S8.1 tests.
Uses SQLite in-memory — no live Postgres or Redis needed.
"""
from __future__ import annotations

import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-fake")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret-s8-1")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")
os.environ.setdefault("BACKEND_URL", "http://localhost:8000")

import knotwork.auth.models                       # noqa: F401  (User, UserMagicToken)
import knotwork.workspaces.models                 # noqa: F401
import knotwork.workspaces.invitations.models     # noqa: F401  (WorkspaceInvitation)
import knotwork.graphs.models                     # noqa: F401
import knotwork.runs.models                       # noqa: F401
import knotwork.knowledge.models                  # noqa: F401
import knotwork.tools.models                      # noqa: F401
import knotwork.escalations.models                # noqa: F401
import knotwork.ratings.models                    # noqa: F401
import knotwork.audit.models                      # noqa: F401
import knotwork.registered_agents.models          # noqa: F401
import knotwork.channels.models                   # noqa: F401
import knotwork.notifications.models              # noqa: F401
import knotwork.openclaw_integrations.models      # noqa: F401
import knotwork.public_workflows.models           # noqa: F401

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
    ws = Workspace(name="Test Workspace", slug="test-workspace-s8-1")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


@pytest.fixture
async def user(db):
    from knotwork.auth.models import User
    u = User(email="alice@example.com", name="Alice", hashed_password="!no-password")
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


@pytest.fixture
async def workspace_member(db, workspace, user):
    """Add `user` as owner of `workspace`."""
    from knotwork.workspaces.models import WorkspaceMember
    m = WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner")
    db.add(m)
    await db.commit()
    return m

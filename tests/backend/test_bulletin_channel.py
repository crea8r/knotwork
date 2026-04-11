from __future__ import annotations

import os

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-fake")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")

import libs.auth.backend.models  # noqa: F401
import libs.audit.backend.models  # noqa: F401
import modules.admin.backend.workspaces_models  # noqa: F401
import modules.assets.backend.knowledge_models  # noqa: F401
import modules.communication.backend.channels_models  # noqa: F401
import modules.communication.backend.notifications_models  # noqa: F401
import modules.communication.backend.escalations_models  # noqa: F401
import modules.projects.backend.projects_models  # noqa: F401
import modules.workflows.backend.graphs_models  # noqa: F401
import modules.workflows.backend.runs_models  # noqa: F401
import modules.workflows.backend.tools_models  # noqa: F401
import modules.workflows.backend.ratings_models  # noqa: F401

from libs.database import Base
from modules.admin.backend.workspaces_models import Workspace
from modules.communication.backend.channels_service import ensure_bulletin_channel, list_channels


@pytest.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite:///:memory:", connect_args={"check_same_thread": False})
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
async def workspace(db):
    ws = Workspace(name="Bulletin Test Workspace", slug="bulletin-test")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


@pytest.mark.asyncio
async def test_ensure_bulletin_channel_creates_single_workspace_bulletin(db, workspace):
    await ensure_bulletin_channel(db, workspace.id)
    await ensure_bulletin_channel(db, workspace.id)

    channels = await list_channels(db, workspace.id)
    bulletins = [channel for channel in channels if channel.channel_type == "bulletin"]

    assert len(bulletins) == 1
    assert bulletins[0].name == "Workspace Bulletin"


@pytest.mark.asyncio
async def test_list_channels_backfills_bulletin_for_existing_workspace(db, workspace):
    channels = await list_channels(db, workspace.id)
    bulletins = [channel for channel in channels if channel.channel_type == "bulletin"]

    assert len(bulletins) == 1

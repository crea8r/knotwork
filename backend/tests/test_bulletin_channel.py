from __future__ import annotations

import os

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test-fake")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")

import knotwork.auth.models  # noqa: F401
import knotwork.workspaces.models  # noqa: F401
import knotwork.graphs.models  # noqa: F401
import knotwork.runs.models  # noqa: F401
import knotwork.knowledge.models  # noqa: F401
import knotwork.tools.models  # noqa: F401
import knotwork.escalations.models  # noqa: F401
import knotwork.ratings.models  # noqa: F401
import knotwork.audit.models  # noqa: F401
import knotwork.channels.models  # noqa: F401
import knotwork.notifications.models  # noqa: F401
import knotwork.openclaw_integrations.models  # noqa: F401
import knotwork.projects.models  # noqa: F401

from knotwork.channels.service import ensure_bulletin_channel, list_channels
from knotwork.database import Base
from knotwork.workspaces.models import Workspace


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

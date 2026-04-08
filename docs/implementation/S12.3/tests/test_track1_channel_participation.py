from __future__ import annotations

import os

import pytest
from sqlalchemy import func, select
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
import knotwork.projects.models  # noqa: F401

from knotwork.auth.models import User
from knotwork.channels.models import Channel, ChannelSubscription
from knotwork.channels.schemas import ChannelMessageCreate
from knotwork.channels.service import (
    create_message,
    list_channel_participants,
    list_channel_subscriptions,
    set_channel_subscription,
)
from knotwork.database import Base
from knotwork.participants import agent_participant_id, human_participant_id
from knotwork.workspaces.models import Workspace, WorkspaceMember


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


async def _workspace(db: AsyncSession) -> Workspace:
    workspace = Workspace(name="S12.3 Workspace", slug="s12-3-workspace")
    db.add(workspace)
    await db.flush()
    return workspace


async def _human_member(db: AsyncSession, workspace: Workspace, name: str, email: str, role: str = "operator") -> tuple[User, str]:
    user = User(name=name, email=email)
    db.add(user)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=role, kind="human"))
    await db.flush()
    return user, human_participant_id(user.id)


async def _agent_member(db: AsyncSession, workspace: Workspace, name: str) -> tuple[User, str]:
    user = User(name=name, public_key=f"{name}-public-key")
    db.add(user)
    await db.flush()
    member = WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="operator", kind="agent")
    db.add(member)
    await db.flush()
    return user, agent_participant_id(member.id)


async def _channel(db: AsyncSession, workspace: Workspace, name: str = "Scoped Channel", channel_type: str = "normal") -> Channel:
    channel = Channel(workspace_id=workspace.id, name=name, slug=name.lower().replace(" ", "-"), channel_type=channel_type)
    db.add(channel)
    await db.flush()
    return channel


@pytest.mark.asyncio
async def test_existing_channel_without_subscription_rows_shows_all_members_as_implicit_participants(db: AsyncSession):
    workspace = await _workspace(db)
    _owner, owner_participant_id = await _human_member(db, workspace, "Owner", "owner@example.com", role="owner")
    _codex, codex_participant_id = await _agent_member(db, workspace, "codex")
    channel = await _channel(db, workspace)
    await db.commit()

    participants = await list_channel_participants(db, workspace.id, channel.id)

    assert {row["participant_id"] for row in participants} == {owner_participant_id, codex_participant_id}
    assert all(row["subscribed"] is True for row in participants)
    assert all(row["implicit"] is True for row in participants)

    subscription_count = (
        await db.execute(
            select(func.count(ChannelSubscription.id)).where(ChannelSubscription.channel_id == channel.id)
        )
    ).scalar_one()
    assert subscription_count == 0


@pytest.mark.asyncio
async def test_leaving_channel_materializes_explicit_participation_without_hiding_other_members(db: AsyncSession):
    workspace = await _workspace(db)
    _owner, owner_participant_id = await _human_member(db, workspace, "Owner", "owner@example.com", role="owner")
    _codex, codex_participant_id = await _agent_member(db, workspace, "codex")
    channel = await _channel(db, workspace)
    await db.commit()

    await set_channel_subscription(db, workspace.id, channel.id, codex_participant_id, subscribed=False)

    participants = await list_channel_participants(db, workspace.id, channel.id)
    by_id = {row["participant_id"]: row for row in participants}
    assert by_id[owner_participant_id]["subscribed"] is True
    assert by_id[owner_participant_id]["implicit"] is False
    assert by_id[codex_participant_id]["subscribed"] is False
    assert by_id[codex_participant_id]["implicit"] is False

    owner_subscriptions = await list_channel_subscriptions(db, workspace.id, owner_participant_id)
    assert any(row.channel_id == channel.id and row.unsubscribed_at is None for row in owner_subscriptions)


@pytest.mark.asyncio
async def test_mention_adds_non_participant_to_channel(db: AsyncSession):
    workspace = await _workspace(db)
    _author, author_participant_id = await _human_member(db, workspace, "Author", "author@example.com", role="owner")
    _codex, codex_participant_id = await _agent_member(db, workspace, "codex")
    channel = await _channel(db, workspace)
    await db.commit()

    await set_channel_subscription(db, workspace.id, channel.id, author_participant_id, subscribed=True)
    await set_channel_subscription(db, workspace.id, channel.id, codex_participant_id, subscribed=False)

    await create_message(
        db,
        workspace_id=workspace.id,
        channel_id=channel.id,
        data=ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name="Author",
            content="Please look at this @codex",
            metadata={"author_participant_id": author_participant_id},
        ),
    )

    subscription = (
        await db.execute(
            select(ChannelSubscription).where(
                ChannelSubscription.workspace_id == workspace.id,
                ChannelSubscription.channel_id == channel.id,
                ChannelSubscription.participant_id == codex_participant_id,
            )
        )
    ).scalar_one()
    assert subscription.unsubscribed_at is None


@pytest.mark.asyncio
async def test_run_channel_participants_cannot_leave(db: AsyncSession):
    workspace = await _workspace(db)
    _owner, owner_participant_id = await _human_member(db, workspace, "Owner", "owner@example.com", role="owner")
    channel = await _channel(db, workspace, name="run-channel", channel_type="run")
    await db.commit()

    with pytest.raises(ValueError, match="Run chat participants cannot leave"):
        await set_channel_subscription(db, workspace.id, channel.id, owner_participant_id, subscribed=False)

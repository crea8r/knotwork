from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

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
import knotwork.projects.models  # noqa: F401

from knotwork.auth.models import User
from knotwork.channels.models import Channel, ChannelEvent, ChannelSubscription
from knotwork.channels.service import inbox_item_by_delivery_id, inbox_items
from knotwork.database import Base
from knotwork.notifications.models import EventDelivery
from knotwork.notifications.service import update_delivery_state
from knotwork.participants import human_participant_id
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


@pytest.fixture
async def workspace(db: AsyncSession):
    ws = Workspace(name="Inbox Update Workspace", slug="inbox-update-workspace")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


@pytest.fixture
async def member_context(db: AsyncSession, workspace: Workspace):
    user = User(name="Inbox User", email="inbox@example.com")
    db.add(user)
    await db.flush()

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user.id,
        role="owner",
        kind="human",
    )
    db.add(member)

    channel = Channel(
        workspace_id=workspace.id,
        name="Inbox Channel",
        slug="inbox-channel",
        channel_type="normal",
    )
    db.add(channel)
    await db.flush()

    participant_id = human_participant_id(user.id)
    db.add(
        ChannelSubscription(
            workspace_id=workspace.id,
            channel_id=channel.id,
            participant_id=participant_id,
        )
    )
    await db.commit()
    await db.refresh(user)
    await db.refresh(channel)

    return {
        "user": user,
        "member": member,
        "channel": channel,
        "participant_id": participant_id,
    }


@pytest.mark.asyncio
async def test_inbox_item_by_delivery_id_returns_archived_item_beyond_archived_list_limit(
    db: AsyncSession,
    workspace: Workspace,
    member_context: dict,
):
    participant_id = member_context["participant_id"]
    channel = member_context["channel"]
    now = datetime.now(timezone.utc)

    for idx in range(101):
        event = ChannelEvent(
            workspace_id=workspace.id,
            channel_id=channel.id,
            event_type="message_posted",
            payload={
                "channel_name": channel.name,
                "message_id": f"archived-{idx}",
                "message_preview": f"Archived message {idx}",
            },
        )
        db.add(event)
        await db.flush()
        db.add(
            EventDelivery(
                workspace_id=workspace.id,
                event_id=event.id,
                participant_id=participant_id,
                delivery_mean="app",
                status="sent",
                sent_at=now + timedelta(minutes=idx + 1),
                read_at=now + timedelta(minutes=idx + 1),
                archived_at=now + timedelta(minutes=idx + 1),
            )
        )

    target_event = ChannelEvent(
        workspace_id=workspace.id,
        channel_id=channel.id,
        event_type="message_posted",
        payload={
            "channel_name": channel.name,
            "message_id": "target-message",
            "message_preview": "Target message",
        },
    )
    db.add(target_event)
    await db.flush()

    target_delivery = EventDelivery(
        workspace_id=workspace.id,
        event_id=target_event.id,
        participant_id=participant_id,
        delivery_mean="app",
        status="sent",
        sent_at=now,
        read_at=None,
        archived_at=None,
    )
    db.add(target_delivery)
    await db.commit()
    await db.refresh(target_delivery)

    updated_delivery = await update_delivery_state(
        db,
        workspace_id=workspace.id,
        participant_id=participant_id,
        delivery_id=target_delivery.id,
        read=True,
        archived=True,
    )

    assert updated_delivery is not None

    archived_rows = await inbox_items(
        db,
        workspace.id,
        participant_id,
        archived=True,
    )
    assert all(row["delivery_id"] != str(target_delivery.id) for row in archived_rows)

    target_row = await inbox_item_by_delivery_id(
        db,
        workspace_id=workspace.id,
        participant_id=participant_id,
        delivery_id=target_delivery.id,
    )

    assert target_row is not None
    assert target_row["delivery_id"] == str(target_delivery.id)
    assert target_row["message_id"] == "target-message"
    assert target_row["archived_at"] is not None

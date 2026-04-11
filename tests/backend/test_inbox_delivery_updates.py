from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

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

from libs.auth.backend.models import User
from libs.database import Base
from libs.participants import human_participant_id
from modules.admin.backend.workspaces_models import Workspace, WorkspaceMember
from modules.communication.backend.channels_models import Channel, ChannelEvent, ChannelSubscription
from modules.communication.backend.channels_service import inbox_item_by_delivery_id, inbox_items
from modules.communication.backend.notifications_models import EventDelivery
from modules.communication.backend.notifications_service import update_delivery_state


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

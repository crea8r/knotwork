from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")

import libs.auth.backend.models  # noqa: F401
import libs.audit.backend.models  # noqa: F401
import modules.admin.backend.workspaces_models  # noqa: F401
import modules.assets.backend.knowledge_models  # noqa: F401
import modules.communication.backend.channels_models  # noqa: F401
import modules.communication.backend.notifications_models  # noqa: F401
import modules.workflows.backend.runs.escalations_models  # noqa: F401
import modules.projects.backend.projects_models  # noqa: F401
import modules.workflows.backend.graphs.models  # noqa: F401
import modules.workflows.backend.runs.models  # noqa: F401

from libs.auth.backend.models import User
from libs.database import Base
from libs.participants import agent_participant_id, human_participant_id
from modules.admin.backend.workspaces_models import Workspace, WorkspaceMember
from modules.communication.backend.channels_models import Channel, ChannelAssetBinding, ChannelEvent, ChannelMessage, ChannelSubscription
from modules.communication.backend.channels_schemas import ChannelMessageCreate
from modules.communication.backend.channels_service import inbox_items
from modules.communication.backend.channel_services.messages import create_message
from modules.workflows.backend.runs.escalations_service import create_escalation
from modules.communication.backend.notifications_models import EventDelivery
from modules.workflows.backend.graphs.models import Graph
from modules.workflows.backend.runs.models import Run, RunNodeState


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
async def workspace(db: AsyncSession) -> Workspace:
    ws = Workspace(name="Communication Test Workspace", slug="communication-test-workspace")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


@pytest.mark.asyncio
async def test_inbox_message_posted_prefers_run_binding_for_run_messages(db: AsyncSession, workspace: Workspace):
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

    participant_id = human_participant_id(user.id)

    older_graph = Graph(
        workspace_id=workspace.id,
        name="Older Workflow",
        path="workflows/older-workflow",
        trigger_config={},
    )
    current_graph = Graph(
        workspace_id=workspace.id,
        name="Current Workflow",
        path="workflows/current-workflow",
        trigger_config={},
    )
    db.add_all([older_graph, current_graph])
    await db.flush()

    channel = Channel(
        workspace_id=workspace.id,
        name="test",
        slug="test-channel",
        channel_type="normal",
    )
    db.add(channel)
    await db.flush()

    db.add(
        ChannelSubscription(
            workspace_id=workspace.id,
            channel_id=channel.id,
            participant_id=participant_id,
        )
    )

    db.add(
        ChannelAssetBinding(
            workspace_id=workspace.id,
            channel_id=channel.id,
            asset_type="workflow",
            asset_id=str(older_graph.id),
        )
    )

    run = Run(
        workspace_id=workspace.id,
        graph_id=current_graph.id,
        graph_version_id=None,
        input={"topic": "test"},
        trigger="manual",
        status="paused",
    )
    db.add(run)
    await db.flush()

    db.add(
        ChannelAssetBinding(
            workspace_id=workspace.id,
            channel_id=channel.id,
            asset_type="run",
            asset_id=run.id,
        )
    )

    message = ChannelMessage(
        workspace_id=workspace.id,
        channel_id=channel.id,
        role="assistant",
        author_type="agent",
        author_name="Agent",
        content="Run update",
        run_id=run.id,
        metadata_={},
    )
    db.add(message)
    await db.flush()

    event = ChannelEvent(
        workspace_id=workspace.id,
        channel_id=channel.id,
        event_type="message_posted",
        source_type="message",
        source_id=str(message.id),
        payload={
            "message_id": str(message.id),
            "channel_name": channel.name,
            "message_preview": "Run update",
        },
    )
    db.add(event)
    await db.flush()

    delivery = EventDelivery(
        workspace_id=workspace.id,
        event_id=event.id,
        participant_id=participant_id,
        delivery_mean="app",
        status="sent",
    )
    db.add(delivery)
    await db.commit()

    rows = await inbox_items(db, workspace.id, participant_id, archived=False)

    assert len(rows) == 1
    assert rows[0]["item_type"] == "message_posted"
    assert rows[0]["run_id"] == run.id
    assert rows[0]["asset_type"] == "run"
    assert rows[0]["asset_id"] == run.id
    assert rows[0]["channel_id"] == str(channel.id)
    assert rows[0]["message_id"] == str(message.id)


@pytest.mark.asyncio
async def test_escalation_delivery_prefers_run_channel_over_workflow_channel(db: AsyncSession, workspace: Workspace):
    user = User(name="Escalation User", email="escalation@example.com")
    db.add(user)
    await db.flush()

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user.id,
        role="owner",
        kind="human",
    )
    db.add(member)

    participant_id = human_participant_id(user.id)

    graph = Graph(
        workspace_id=workspace.id,
        name="Escalation Workflow",
        path="workflows/escalation-workflow",
        trigger_config={},
    )
    db.add(graph)
    await db.flush()

    workflow_channel = Channel(
        workspace_id=workspace.id,
        name="workflow discussion",
        slug="workflow-discussion",
        channel_type="workflow",
        graph_id=graph.id,
    )
    db.add(workflow_channel)
    await db.flush()

    db.add(
        ChannelSubscription(
            workspace_id=workspace.id,
            channel_id=workflow_channel.id,
            participant_id=participant_id,
        )
    )

    run = Run(
        workspace_id=workspace.id,
        graph_id=graph.id,
        graph_version_id=None,
        input={"topic": "test"},
        trigger="manual",
        status="paused",
    )
    db.add(run)
    await db.flush()

    run_channel = Channel(
        workspace_id=workspace.id,
        name=f"run:{run.id}",
        slug=f"run-{run.id}",
        channel_type="run",
        graph_id=graph.id,
    )
    db.add(run_channel)
    await db.flush()

    db.add(
        ChannelSubscription(
            workspace_id=workspace.id,
            channel_id=run_channel.id,
            participant_id=participant_id,
        )
    )

    node_state = RunNodeState(
        run_id=run.id,
        node_id="agent",
        node_name="Agent",
        status="paused",
    )
    db.add(node_state)
    await db.commit()
    await db.refresh(node_state)

    await create_escalation(
        db,
        run_id=run.id,
        run_node_state_id=node_state.id,
        workspace_id=workspace.id,
        type="agent_question",
        context={"reason": "Need human input"},
        assigned_to=[participant_id],
    )

    rows = await inbox_items(db, workspace.id, participant_id, archived=False)
    escalation_rows = [row for row in rows if row["item_type"] == "escalation" and row["run_id"] == run.id]

    assert len(escalation_rows) == 1
    assert escalation_rows[0]["channel_id"] == str(run_channel.id)


@pytest.mark.asyncio
async def test_assigned_run_request_message_publishes_task_assigned_and_preserves_run_context(
    db: AsyncSession,
    workspace: Workspace,
):
    user = User(name="Assigned User", email="assigned@example.com")
    db.add(user)
    await db.flush()

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user.id,
        role="owner",
        kind="human",
    )
    db.add(member)
    await db.flush()

    participant_id = human_participant_id(user.id)

    graph = Graph(
        workspace_id=workspace.id,
        name="Assigned Workflow",
        path="workflows/assigned-workflow",
        trigger_config={},
    )
    db.add(graph)
    await db.flush()

    channel = Channel(
        workspace_id=workspace.id,
        name="run discussion",
        slug="run-discussion",
        channel_type="run",
        graph_id=graph.id,
    )
    db.add(channel)
    await db.flush()

    db.add(
        ChannelSubscription(
            workspace_id=workspace.id,
            channel_id=channel.id,
            participant_id=participant_id,
        )
    )

    run = Run(
        workspace_id=workspace.id,
        graph_id=graph.id,
        graph_version_id=None,
        input={"topic": "test"},
        trigger="manual",
        status="paused",
    )
    db.add(run)
    await db.flush()

    db.add(
        ChannelAssetBinding(
            workspace_id=workspace.id,
            channel_id=channel.id,
            asset_type="run",
            asset_id=run.id,
        )
    )
    await db.commit()

    message = await create_message(
        db,
        workspace.id,
        channel.id,
        ChannelMessageCreate(
            role="assistant",
            author_type="system",
            author_name="Workflow Orchestrator",
            content="Please review the latest run output.",
            run_id=run.id,
            metadata={
                "kind": "request",
                "assigned_to": [participant_id],
                "request": {
                    "type": "agent_question",
                    "status": "open",
                    "assigned_to": [participant_id],
                },
            },
        ),
    )
    await db.commit()

    event_result = await db.execute(
        select(ChannelEvent)
        .where(ChannelEvent.source_type == "message", ChannelEvent.source_id == str(message.id))
        .order_by(ChannelEvent.created_at.desc(), ChannelEvent.id.desc())
    )
    events = list(event_result.scalars())
    assert len(events) == 1
    assert events[0].event_type == "task_assigned"

    delivery_result = await db.execute(
        select(EventDelivery).where(
            EventDelivery.event_id == events[0].id,
            EventDelivery.participant_id == participant_id,
            EventDelivery.delivery_mean == "app",
            EventDelivery.status == "sent",
        )
    )
    delivery = delivery_result.scalar_one()

    rows = await inbox_items(db, workspace.id, participant_id, archived=False)
    task_rows = [row for row in rows if row["delivery_id"] == str(delivery.id)]

    assert len(task_rows) == 1
    assert task_rows[0]["item_type"] == "task_assigned"
    assert task_rows[0]["run_id"] == run.id
    assert task_rows[0]["channel_id"] == str(channel.id)
    assert task_rows[0]["message_id"] == str(message.id)


@pytest.mark.asyncio
async def test_mentions_do_not_also_receive_message_posted_delivery(db: AsyncSession, workspace: Workspace):
    author = User(name="Author User", email="author@example.com")
    mentioned_agent_user = User(name="Agent Helper", email="agent-helper@example.com")
    observer = User(name="Observer User", email="observer@example.com")
    db.add_all([author, mentioned_agent_user, observer])
    await db.flush()

    author_member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=author.id,
        role="owner",
        kind="human",
    )
    mentioned_agent_member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=mentioned_agent_user.id,
        role="operator",
        kind="agent",
        agent_config={"agent_ref": "agent"},
    )
    observer_member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=observer.id,
        role="owner",
        kind="human",
    )
    db.add_all([author_member, mentioned_agent_member, observer_member])
    await db.flush()

    channel = Channel(
        workspace_id=workspace.id,
        name="mentions",
        slug="mentions-channel",
        channel_type="normal",
    )
    db.add(channel)
    await db.flush()

    author_participant_id = human_participant_id(author.id)
    mentioned_agent_participant_id = agent_participant_id(mentioned_agent_member.id)
    observer_participant_id = human_participant_id(observer.id)

    db.add_all(
        [
            ChannelSubscription(
                workspace_id=workspace.id,
                channel_id=channel.id,
                participant_id=author_participant_id,
            ),
            ChannelSubscription(
                workspace_id=workspace.id,
                channel_id=channel.id,
                participant_id=mentioned_agent_participant_id,
            ),
            ChannelSubscription(
                workspace_id=workspace.id,
                channel_id=channel.id,
                participant_id=observer_participant_id,
            ),
        ]
    )
    await db.commit()

    message = await create_message(
        db,
        workspace.id,
        channel.id,
        ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name="Author User",
            content="@agent please update this file",
            metadata={"author_participant_id": author_participant_id},
        ),
    )

    event_result = await db.execute(
        select(ChannelEvent)
        .where(ChannelEvent.source_type == "message", ChannelEvent.source_id == str(message.id))
        .order_by(ChannelEvent.created_at.asc(), ChannelEvent.id.asc())
    )
    events = list(event_result.scalars())

    assert {event.event_type for event in events} == {"message_posted", "mentioned_message"}

    message_posted_event = next(event for event in events if event.event_type == "message_posted")
    mentioned_event = next(event for event in events if event.event_type == "mentioned_message")

    delivery_result = await db.execute(
        select(EventDelivery).where(EventDelivery.event_id.in_([message_posted_event.id, mentioned_event.id]))
    )
    deliveries = list(delivery_result.scalars())

    posted_recipients = {
        delivery.participant_id
        for delivery in deliveries
        if delivery.event_id == message_posted_event.id
    }
    mentioned_recipients = {
        delivery.participant_id
        for delivery in deliveries
        if delivery.event_id == mentioned_event.id
    }

    assert posted_recipients == {observer_participant_id}
    assert mentioned_recipients == {mentioned_agent_participant_id}


@pytest.mark.asyncio
async def test_knowledge_change_created_message_does_not_publish_inbox_event(db: AsyncSession, workspace: Workspace):
    user = User(name="Review User", email="review@example.com")
    db.add(user)
    await db.flush()

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user.id,
        role="owner",
        kind="human",
    )
    db.add(member)
    await db.flush()

    participant_id = human_participant_id(user.id)

    channel = Channel(
        workspace_id=workspace.id,
        name="review discussion",
        slug="review-discussion",
        channel_type="normal",
    )
    db.add(channel)
    await db.flush()

    db.add(
        ChannelSubscription(
            workspace_id=workspace.id,
            channel_id=channel.id,
            participant_id=participant_id,
        )
    )
    await db.commit()

    message = await create_message(
        db,
        workspace.id,
        channel.id,
        ChannelMessageCreate(
            role="system",
            author_type="system",
            author_name="Knotwork",
            content="Proposed a knowledge change for `marketing/positioning basic.md`.",
            metadata={
                "kind": "knowledge_change_created",
                "proposal_id": "proposal-1",
                "path": "marketing/positioning basic.md",
                "inline_review": True,
            },
        ),
    )
    await db.commit()

    event_result = await db.execute(
        select(ChannelEvent)
        .where(ChannelEvent.source_type == "message", ChannelEvent.source_id == str(message.id))
        .order_by(ChannelEvent.created_at.asc(), ChannelEvent.id.asc())
    )

    assert list(event_result.scalars()) == []
    assert await inbox_items(db, workspace.id, participant_id, archived=False) == []


@pytest.mark.asyncio
async def test_inbox_skips_legacy_knowledge_change_created_receipt_messages(db: AsyncSession, workspace: Workspace):
    user = User(name="Legacy Review User", email="legacy-review@example.com")
    db.add(user)
    await db.flush()

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user.id,
        role="owner",
        kind="human",
    )
    db.add(member)

    participant_id = human_participant_id(user.id)

    channel = Channel(
        workspace_id=workspace.id,
        name="review discussion legacy",
        slug="review-discussion-legacy",
        channel_type="normal",
    )
    db.add(channel)
    await db.flush()

    db.add(
        ChannelSubscription(
            workspace_id=workspace.id,
            channel_id=channel.id,
            participant_id=participant_id,
        )
    )

    message = ChannelMessage(
        workspace_id=workspace.id,
        channel_id=channel.id,
        role="system",
        author_type="system",
        author_name="Knotwork",
        content="Proposed a knowledge change for `marketing/positioning basic.md`.",
        run_id=None,
        metadata_={
            "kind": "knowledge_change_created",
            "proposal_id": "proposal-legacy",
            "path": "marketing/positioning basic.md",
            "inline_review": True,
        },
    )
    db.add(message)
    await db.flush()

    event = ChannelEvent(
        workspace_id=workspace.id,
        channel_id=channel.id,
        event_type="message_posted",
        source_type="message",
        source_id=str(message.id),
        payload={
            "message_id": str(message.id),
            "channel_name": channel.name,
            "message_preview": message.content,
        },
    )
    db.add(event)
    await db.flush()

    delivery = EventDelivery(
        workspace_id=workspace.id,
        event_id=event.id,
        participant_id=participant_id,
        delivery_mean="app",
        status="sent",
    )
    db.add(delivery)
    await db.commit()

    assert await inbox_items(db, workspace.id, participant_id, archived=False) == []


@pytest.mark.asyncio
async def test_inbox_skips_side_channel_run_announcement_messages(db: AsyncSession, workspace: Workspace):
    user = User(name="Announcement User", email="announcement@example.com")
    db.add(user)
    await db.flush()

    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user.id,
        role="owner",
        kind="human",
    )
    db.add(member)

    participant_id = human_participant_id(user.id)

    channel = Channel(
        workspace_id=workspace.id,
        name="workflow discussion",
        slug="workflow-discussion-2",
        channel_type="normal",
    )
    db.add(channel)
    await db.flush()

    db.add(
        ChannelSubscription(
            workspace_id=workspace.id,
            channel_id=channel.id,
            participant_id=participant_id,
        )
    )

    message = ChannelMessage(
        workspace_id=workspace.id,
        channel_id=channel.id,
        role="system",
        author_type="system",
        author_name="Knotwork",
        content="New run created from attached workflow: run 1",
        run_id=None,
        metadata_={"kind": "workflow_run_created", "run_id": "run-1"},
    )
    db.add(message)
    await db.flush()

    event = ChannelEvent(
        workspace_id=workspace.id,
        channel_id=channel.id,
        event_type="message_posted",
        source_type="message",
        source_id=str(message.id),
        payload={
            "message_id": str(message.id),
            "channel_name": channel.name,
            "message_preview": message.content,
        },
    )
    db.add(event)
    await db.flush()

    delivery = EventDelivery(
        workspace_id=workspace.id,
        event_id=event.id,
        participant_id=participant_id,
        delivery_mean="app",
        status="sent",
    )
    db.add(delivery)
    await db.commit()

    rows = await inbox_items(db, workspace.id, participant_id, archived=False)

    assert rows == []

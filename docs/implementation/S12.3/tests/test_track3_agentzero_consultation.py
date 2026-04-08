from __future__ import annotations

import os

import pytest
from sqlalchemy import select
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
from knotwork.channels.models import ChannelSubscription
from knotwork.channels.service import get_or_create_objective_agentzero_consultation
from knotwork.database import Base
from knotwork.participants import agent_participant_id, human_participant_id
from knotwork.projects.models import Objective
from knotwork.projects.models import Project
from knotwork.projects.service import list_project_channels
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


@pytest.mark.asyncio
async def test_objective_agentzero_consultation_is_private_to_requester_and_agentzero(db: AsyncSession):
    workspace = Workspace(name="S12.3 Workspace", slug="s12-3-track3")
    requester = User(name="Requester", email="requester@example.com")
    agentzero_user = User(name="Codex", public_key="codex-public-key")
    bystander = User(name="Bystander", email="bystander@example.com")
    db.add_all([workspace, requester, agentzero_user, bystander])
    await db.flush()

    requester_member = WorkspaceMember(workspace_id=workspace.id, user_id=requester.id, role="operator", kind="human")
    agentzero_member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=agentzero_user.id,
        role="operator",
        kind="agent",
        agent_zero_role=True,
    )
    bystander_member = WorkspaceMember(workspace_id=workspace.id, user_id=bystander.id, role="operator", kind="human")
    objective = Objective(workspace_id=workspace.id, code="OBJ.1", slug="obj-1", title="Unblock the work")
    db.add_all([requester_member, agentzero_member, bystander_member, objective])
    await db.commit()

    channel = await get_or_create_objective_agentzero_consultation(
        db,
        workspace.id,
        objective.id,
        requester_member,
        requester,
    )
    again = await get_or_create_objective_agentzero_consultation(
        db,
        workspace.id,
        objective.id,
        requester_member,
        requester,
    )

    assert again.id == channel.id
    assert channel.channel_type == "consultation"
    assert channel.objective_id == objective.id

    subscriptions = (
        await db.execute(
            select(ChannelSubscription.participant_id).where(
                ChannelSubscription.channel_id == channel.id,
                ChannelSubscription.unsubscribed_at.is_(None),
            )
        )
    ).all()
    assert {row[0] for row in subscriptions} == {
        human_participant_id(requester.id),
        agent_participant_id(agentzero_member.id),
    }
    assert human_participant_id(bystander.id) not in {row[0] for row in subscriptions}


@pytest.mark.asyncio
async def test_objective_agentzero_consultation_is_hidden_from_project_channel_listing(db: AsyncSession):
    workspace = Workspace(name="S12.3 Workspace", slug="s12-3-track3-listing")
    requester = User(name="Requester", email="requester@example.com")
    agentzero_user = User(name="Codex", public_key="codex-public-key")
    db.add_all([workspace, requester, agentzero_user])
    await db.flush()
    project = Project(workspace_id=workspace.id, title="Project", slug="project", description="")
    db.add(project)
    await db.flush()

    requester_member = WorkspaceMember(workspace_id=workspace.id, user_id=requester.id, role="operator", kind="human")
    agentzero_member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=agentzero_user.id,
        role="operator",
        kind="agent",
        agent_zero_role=True,
    )
    objective = Objective(
        workspace_id=workspace.id,
        project_id=project.id,
        code="OBJ.1",
        slug="obj-1-listing",
        title="Unblock the work",
    )
    db.add_all([requester_member, agentzero_member, objective])
    await db.commit()

    consultation = await get_or_create_objective_agentzero_consultation(
        db,
        workspace.id,
        objective.id,
        requester_member,
        requester,
    )

    channels = await list_project_channels(db, workspace.id, project.id, include_archived=True)

    assert consultation.id not in {channel.id for channel in channels}
    assert all(channel.channel_type != "consultation" for channel in channels)

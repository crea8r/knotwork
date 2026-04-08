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
from knotwork.channels.models import Channel
from knotwork.channels.service import list_channel_participants
from knotwork.database import Base
from knotwork.participants import agent_participant_id, human_participant_id, list_workspace_participants
from knotwork.workspaces.router import UpdateMemberAccessIn, update_workspace_member_access
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
async def test_agentzero_role_can_attach_to_human_or_agent_and_surface_in_participants(db: AsyncSession):
    workspace = Workspace(name="S12.3 Workspace", slug="s12-3-agentzero")
    human = User(name="Human Lead", email="lead@example.com")
    agent = User(name="Codex", public_key="codex-public-key")
    db.add_all([workspace, human, agent])
    await db.flush()

    human_member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=human.id,
        role="operator",
        kind="human",
        agent_zero_role=True,
    )
    agent_member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=agent.id,
        role="operator",
        kind="agent",
    )
    channel = Channel(workspace_id=workspace.id, name="Top Line", slug="top-line", channel_type="normal")
    db.add_all([human_member, agent_member, channel])
    await db.commit()

    workspace_participants = {
        row["participant_id"]: row
        for row in await list_workspace_participants(db, workspace.id)
    }
    assert workspace_participants[human_participant_id(human.id)]["agent_zero_role"] is True
    assert workspace_participants[agent_participant_id(agent_member.id)]["agent_zero_role"] is False

    channel_participants = {
        row["participant_id"]: row
        for row in await list_channel_participants(db, workspace.id, channel.id)
    }
    assert channel_participants[human_participant_id(human.id)]["agent_zero_role"] is True
    assert channel_participants[agent_participant_id(agent_member.id)]["agent_zero_role"] is False


@pytest.mark.asyncio
async def test_assigning_agentzero_role_clears_previous_workspace_agentzero(db: AsyncSession):
    workspace = Workspace(name="S12.3 Workspace", slug="s12-3-agentzero-unique")
    owner = User(name="Owner", email="owner@example.com")
    human = User(name="Human Lead", email="lead@example.com")
    agent = User(name="Codex", public_key="codex-public-key")
    db.add_all([workspace, owner, human, agent])
    await db.flush()

    owner_member = WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="owner", kind="human")
    human_member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=human.id,
        role="operator",
        kind="human",
        agent_zero_role=True,
    )
    agent_member = WorkspaceMember(workspace_id=workspace.id, user_id=agent.id, role="operator", kind="agent")
    db.add_all([owner_member, human_member, agent_member])
    await db.commit()

    await update_workspace_member_access(
        workspace_id=workspace.id,
        member_id=agent_member.id,
        data=UpdateMemberAccessIn(agent_zero_role=True),
        user=owner,
        caller_member=owner_member,
        db=db,
    )

    rows = (
        await db.execute(
            select(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == workspace.id)
            .order_by(WorkspaceMember.created_at)
        )
    ).scalars().all()
    by_id = {row.id: row for row in rows}
    assert by_id[human_member.id].agent_zero_role is False
    assert by_id[agent_member.id].agent_zero_role is True
    assert sum(1 for row in rows if row.agent_zero_role) == 1

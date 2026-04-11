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
import modules.communication.backend.notifications_service  # noqa: F401
import modules.communication.backend.escalations_models  # noqa: F401
import modules.projects.backend.projects_models  # noqa: F401
import modules.workflows.backend.graphs_models  # noqa: F401
import modules.workflows.backend.runs_models  # noqa: F401
import modules.workflows.backend.tools_models  # noqa: F401
import modules.workflows.backend.ratings_models  # noqa: F401

from libs.auth.backend.models import User
from libs.database import Base
from libs.participants import list_workspace_human_participants, list_workspace_participants, resolve_mentioned_participants
from modules.admin.backend.workspaces_models import Workspace, WorkspaceMember
from modules.communication.backend.notifications_service import default_preference_state, resolve_email_address


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
    ws = Workspace(name="Participant Test Workspace", slug="participant-test")
    db.add(ws)
    await db.commit()
    await db.refresh(ws)
    return ws


async def _create_member(
    db: AsyncSession,
    workspace: Workspace,
    *,
    name: str,
    kind: str,
    email: str | None = None,
    public_key: str | None = None,
):
    user = User(name=name, email=email, public_key=public_key)
    db.add(user)
    await db.flush()
    member = WorkspaceMember(
        workspace_id=workspace.id,
        user_id=user.id,
        role="operator",
        kind=kind,
    )
    db.add(member)
    await db.commit()
    await db.refresh(user)
    await db.refresh(member)
    return user, member


@pytest.mark.asyncio
async def test_participant_lists_do_not_duplicate_agents_as_humans(db, workspace):
    human_user, _ = await _create_member(
        db,
        workspace,
        name="Hieu Human",
        kind="human",
        email="hieu@example.com",
    )
    agent_user, agent_member = await _create_member(
        db,
        workspace,
        name="OpenClaw Test Agent",
        kind="agent",
        email="agent@example.com",
        public_key="test-public-key",
    )

    humans = await list_workspace_human_participants(db, workspace.id)
    participants = await list_workspace_participants(db, workspace.id)
    mentioned = await resolve_mentioned_participants(db, workspace.id, "@agent")

    assert [row["participant_id"] for row in humans] == [f"human:{human_user.id}"]
    assert {row["participant_id"] for row in participants} == {
        f"human:{human_user.id}",
        f"agent:{agent_member.id}",
    }
    assert all(row["participant_id"] != f"human:{agent_user.id}" for row in participants)
    assert [row["participant_id"] for row in mentioned] == [f"agent:{agent_member.id}"]


@pytest.mark.asyncio
async def test_delivery_defaults_and_email_lookup_are_member_based(db, workspace):
    human_user, _ = await _create_member(
        db,
        workspace,
        name="Hieu Human",
        kind="human",
        email="hieu@example.com",
    )
    agent_user, agent_member = await _create_member(
        db,
        workspace,
        name="OpenClaw Test Agent",
        kind="agent",
        email="agent@example.com",
        public_key="test-public-key",
    )

    assert default_preference_state(f"human:{human_user.id}", "mentioned_message") == {
        "app_enabled": True,
        "email_enabled": False,
        "push_enabled": True,
    }
    assert default_preference_state(f"agent:{agent_member.id}", "mentioned_message") == {
        "app_enabled": True,
        "email_enabled": False,
        "push_enabled": True,
    }
    assert await resolve_email_address(db, f"agent:{agent_member.id}") == agent_user.email


@pytest.mark.asyncio
async def test_disabled_members_are_hidden_from_participants_and_mentions(db, workspace):
    active_user, _ = await _create_member(
        db,
        workspace,
        name="Active Human",
        kind="human",
        email="active@example.com",
    )
    _, disabled_member = await _create_member(
        db,
        workspace,
        name="Disabled Agent",
        kind="agent",
        email="disabled-agent@example.com",
        public_key="disabled-public-key",
    )
    disabled_member.access_disabled_at = workspace.created_at
    await db.commit()

    participants = await list_workspace_participants(db, workspace.id)
    mentioned = await resolve_mentioned_participants(db, workspace.id, "@disabled")

    assert [row["participant_id"] for row in participants] == [f"human:{active_user.id}"]
    assert mentioned == []

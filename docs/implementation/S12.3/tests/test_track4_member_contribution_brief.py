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
import knotwork.projects.models  # noqa: F401

from knotwork.auth.models import User
from knotwork.database import Base
from knotwork.participants import human_participant_id, list_workspace_participants
from knotwork.workspaces.models import Workspace, WorkspaceMember
from knotwork.workspaces.router import UpdateMemberAccessIn, get_workspace_member_detail, update_workspace_member_access


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
async def test_member_contribution_brief_is_workspace_specific_and_visible_to_participants(db: AsyncSession):
    workspace = Workspace(name="S12.3 Workspace", slug="s12-3-member-brief")
    user = User(name="Support Lead", email="support@example.com")
    db.add_all([workspace, user])
    await db.flush()
    member = WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="operator", kind="human")
    db.add(member)
    await db.commit()

    updated = await update_workspace_member_access(
        workspace_id=workspace.id,
        member_id=member.id,
        data=UpdateMemberAccessIn(
            contribution_brief="Customer support: bring customer pain into objectives and validate fixes.",
            availability_status="blocked",
            capacity_level="full",
            status_note="Blocked on customer call transcripts.",
            current_commitments=[{"title": "Review support backlog"}],
            recent_work=[{"title": "Escalated onboarding issue"}],
        ),
        user=user,
        caller_member=member,
        db=db,
    )

    assert updated.contribution_brief == "Customer support: bring customer pain into objectives and validate fixes."
    assert updated.availability_status == "blocked"
    assert updated.capacity_level == "full"
    assert updated.status_note == "Blocked on customer call transcripts."
    assert updated.current_commitments == [{"title": "Review support backlog"}]
    assert updated.recent_work == [{"title": "Escalated onboarding issue"}]
    assert updated.status_updated_at is not None

    detail = await get_workspace_member_detail(workspace.id, member.id, member, db)
    assert detail.contribution_brief == updated.contribution_brief
    assert detail.availability_status == "blocked"
    assert detail.current_commitments == [{"title": "Review support backlog"}]

    participants = {
        row["participant_id"]: row
        for row in await list_workspace_participants(db, workspace.id)
    }
    assert participants[human_participant_id(user.id)]["contribution_brief"] == updated.contribution_brief
    assert participants[human_participant_id(user.id)]["availability_status"] == "blocked"
    assert participants[human_participant_id(user.id)]["capacity_level"] == "full"

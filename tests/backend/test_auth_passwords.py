from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy import create_engine as create_sync_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_SECRET", "test-secret")

import libs.auth.backend.models  # noqa: F401
import libs.audit.backend.models  # noqa: F401
import modules.admin.backend.invitations_models  # noqa: F401
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

from libs.auth.backend.models import User, UserPasswordResetToken
from libs.auth.backend.service import (
    authenticate_user_by_password,
    consume_password_reset_token,
    create_password_reset_token,
    set_user_password,
)
from libs.database import Base
from modules.admin.backend import invitations_service
from modules.admin.backend.invitations_models import WorkspaceInvitation
from modules.admin.backend.workspaces_models import Workspace, WorkspaceMember

ROOT = Path(__file__).resolve().parents[2]


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
async def test_password_auth_and_reset_token_round_trip(db: AsyncSession):
    user = User(email="owner@example.com", name="Owner")
    set_user_password(user, "admin", must_change_password=True)
    db.add(user)
    workspace = Workspace(name="Primary", slug="primary")
    db.add(workspace)
    await db.flush()

    member = WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner")
    db.add(member)
    await db.commit()

    authed = await authenticate_user_by_password(db, "owner@example.com", "admin")
    assert authed is not None
    assert authed.must_change_password is True

    token = await create_password_reset_token(db, user)
    await db.commit()
    consumed = await consume_password_reset_token(db, token)
    assert consumed is not None
    set_user_password(consumed, "better-password")
    await db.commit()

    authed_after_reset = await authenticate_user_by_password(db, "owner@example.com", "better-password")
    assert authed_after_reset is not None
    assert authed_after_reset.must_change_password is False

    second_consume = await consume_password_reset_token(db, token)
    assert second_consume is None


@pytest.mark.asyncio
async def test_password_reset_token_expires(db: AsyncSession):
    user = User(email="member@example.com", name="Member")
    set_user_password(user, "secret")
    db.add(user)
    await db.flush()

    row = UserPasswordResetToken(
        user_id=user.id,
        token="expired-token",
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        used=False,
    )
    db.add(row)
    await db.commit()

    consumed = await consume_password_reset_token(db, "expired-token")
    assert consumed is None


@pytest.mark.asyncio
async def test_accept_invitation_sets_password_and_role(db: AsyncSession):
    workspace = Workspace(name="Invites", slug="invites")
    db.add(workspace)
    await db.flush()

    invitation = WorkspaceInvitation(
        id=uuid4(),
        workspace_id=workspace.id,
        invited_by_user_id=None,
        email="invitee@example.com",
        role="operator",
        token="invite-token",
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add(invitation)
    await db.commit()

    accepted = await invitations_service.accept_invitation(db, "invite-token", "Invitee", "pass1234")

    authed = await authenticate_user_by_password(db, "invitee@example.com", "pass1234")
    member = await db.scalar(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id).limit(1))

    assert accepted.email == "invitee@example.com"
    assert accepted.role == "operator"
    assert authed is not None
    assert member is not None


def test_bootstrap_owner_defaults_to_admin_password(tmp_path: Path):
    db_path = tmp_path / "bootstrap.sqlite"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path}"
    env["DATABASE_URL_SYNC"] = f"sqlite:///{db_path}"
    env["REDIS_URL"] = "redis://localhost:6379"
    env["JWT_SECRET"] = "test-secret"

    sync_engine = create_sync_engine(env["DATABASE_URL_SYNC"])
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()
    result = subprocess.run(
        [
            sys.executable,
            "scripts/bootstrap_owner.py",
            "--owner-name",
            "Owner",
            "--owner-email",
            "owner@example.com",
        ],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    payload = json.loads(result.stdout)
    assert payload["uses_default_password"] is True

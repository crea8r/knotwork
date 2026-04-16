"""Core facade for workspace/member lookups used across modules."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from libs.auth.backend.models import User
from modules.admin.backend.workspaces_models import Workspace, WorkspaceMember


async def get_workspace(db: AsyncSession, workspace_id: UUID):
    return await db.get(Workspace, workspace_id)


async def get_workspace_email_config(db: AsyncSession, workspace_id: UUID) -> dict[str, str | None]:
    workspace = await get_workspace(db, workspace_id)
    if workspace is None:
        return {"resend_api_key": None, "email_from": None}
    return {
        "resend_api_key": (workspace.resend_api_key or "").strip() or None,
        "email_from": (workspace.email_from or "").strip() or None,
    }


async def get_member(db: AsyncSession, member_id: UUID):
    return await db.get(WorkspaceMember, member_id)


async def has_active_member_access(db: AsyncSession, workspace_id: UUID, member_id: UUID) -> bool:
    member = await get_member(db, member_id)
    return bool(
        member
        and member.workspace_id == workspace_id
        and member.access_disabled_at is None
    )


async def has_active_user_membership(db: AsyncSession, workspace_id: UUID, user_id: UUID) -> bool:
    member = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.access_disabled_at.is_(None),
        ).limit(1)
    )
    return member is not None


async def get_agentzero_member_user(db: AsyncSession, workspace_id: UUID):
    row = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.agent_zero_role.is_(True),
            WorkspaceMember.access_disabled_at.is_(None),
        )
        .limit(1)
    )
    return row.first()

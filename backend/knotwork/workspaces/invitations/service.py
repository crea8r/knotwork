"""Workspace invitation service: create, verify, and accept invitations."""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

logger = logging.getLogger(__name__)

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.service import create_access_token, get_or_create_user
from knotwork.config import settings
from knotwork.notifications.channels.email import send as send_email
from knotwork.workspaces.invitations.models import WorkspaceInvitation
from knotwork.workspaces.invitations.schemas import (
    AcceptInvitationOut,
    CreateInvitationRequest,
    InvitationOut,
    InvitationVerifyOut,
)
from knotwork.workspaces.models import Workspace, WorkspaceMember

_INVITE_TTL_DAYS = 7


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def _to_out(inv: WorkspaceInvitation) -> InvitationOut:
    return InvitationOut(
        id=inv.id,
        workspace_id=inv.workspace_id,
        email=inv.email,
        role=inv.role,
        expires_at=inv.expires_at,
        accepted_at=inv.accepted_at,
        created_at=inv.created_at,
        token_hint=inv.token[-6:],
    )


async def create_invitation(
    db: AsyncSession,
    workspace_id: UUID,
    invited_by_user_id: UUID | None,
    req: CreateInvitationRequest,
) -> InvitationOut:
    if not settings.invitations_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invitations are disabled on localhost installs until public email delivery is configured.",
        )

    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    email = req.email.lower().strip()
    token_str = _new_token()
    inv = WorkspaceInvitation(
        id=uuid4(),
        workspace_id=workspace_id,
        invited_by_user_id=invited_by_user_id,
        email=email,
        role=req.role,
        token=token_str,
        expires_at=_now() + timedelta(days=_INVITE_TTL_DAYS),
    )
    db.add(inv)
    await db.flush()

    invite_url = f"{settings.normalized_frontend_url}/accept-invite?token={token_str}"
    body = (
        f"You've been invited to join the '{workspace.name}' workspace on Knotwork.\n\n"
        f"Click the link below to accept your invitation (expires in {_INVITE_TTL_DAYS} days):\n\n"
        f"{invite_url}\n\n"
        f"If you didn't expect this invitation, you can safely ignore it."
    )
    try:
        await send_email(
            to_address=email,
            subject=f"You're invited to '{workspace.name}' on Knotwork",
            body=body,
            from_address=settings.email_from,
        )
    except Exception as exc:
        logger.error("Invitation email failed for %s: %s", email, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invitation email could not be delivered. Check email configuration and try again.",
        ) from exc

    await db.commit()
    return _to_out(inv)


async def list_invitations(
    db: AsyncSession, workspace_id: UUID
) -> list[InvitationOut]:
    rows = await db.execute(
        select(WorkspaceInvitation)
        .where(WorkspaceInvitation.workspace_id == workspace_id)
        .order_by(WorkspaceInvitation.created_at.desc())
    )
    return [_to_out(r) for r in rows.scalars()]


async def get_invitation_by_token(
    db: AsyncSession, token_str: str
) -> InvitationVerifyOut:
    result = await db.execute(
        select(WorkspaceInvitation).where(WorkspaceInvitation.token == token_str)
    )
    inv: WorkspaceInvitation | None = result.scalar_one_or_none()
    if inv is None:
        raise HTTPException(status_code=404, detail="Invitation not found or invalid")
    # Timezone-safe: SQLite may return naive datetimes for timezone=True columns.
    _now_dt = _now()
    _exp = inv.expires_at
    _cmp = _now_dt if _exp.tzinfo is not None else _now_dt.replace(tzinfo=None)
    if _exp < _cmp and inv.accepted_at is None:
        raise HTTPException(status_code=410, detail="Invitation has expired")

    workspace = await db.get(Workspace, inv.workspace_id)
    workspace_name = workspace.name if workspace else "Unknown workspace"

    return InvitationVerifyOut(
        email=inv.email,
        workspace_name=workspace_name,
        role=inv.role,
        expires_at=inv.expires_at,
        already_accepted=inv.accepted_at is not None,
    )


async def accept_invitation(
    db: AsyncSession, token_str: str, name: str
) -> AcceptInvitationOut:
    result = await db.execute(
        select(WorkspaceInvitation).where(WorkspaceInvitation.token == token_str)
    )
    inv: WorkspaceInvitation | None = result.scalar_one_or_none()
    if inv is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if inv.accepted_at is not None:
        raise HTTPException(status_code=409, detail="Invitation already accepted")
    # Timezone-safe: SQLite may return naive datetimes for timezone=True columns.
    _now_dt2 = _now()
    _exp2 = inv.expires_at
    _cmp2 = _now_dt2 if _exp2.tzinfo is not None else _now_dt2.replace(tzinfo=None)
    if _exp2 < _cmp2:
        raise HTTPException(status_code=410, detail="Invitation has expired")

    user, _ = await get_or_create_user(db, inv.email, name)

    # Upsert workspace member
    existing_q = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == inv.workspace_id,
            WorkspaceMember.user_id == user.id,
        )
    )
    if existing_q.scalar_one_or_none() is None:
        db.add(WorkspaceMember(
            workspace_id=inv.workspace_id,
            user_id=user.id,
            role=inv.role,
        ))

    inv.accepted_at = _now()
    await db.flush()

    access_token = create_access_token(user.id)
    await db.commit()

    return AcceptInvitationOut(
        access_token=access_token,
        user_id=user.id,
        workspace_id=inv.workspace_id,
        name=user.name,
        email=user.email,
    )

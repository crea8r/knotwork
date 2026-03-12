"""Workspace invitation endpoints."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.deps import get_current_user, require_owner
from knotwork.auth.models import User
from knotwork.database import get_db
from knotwork.workspaces.invitations.schemas import (
    AcceptInvitationOut,
    AcceptInvitationRequest,
    CreateInvitationRequest,
    InvitationOut,
    InvitationVerifyOut,
)
from knotwork.workspaces.invitations import service
from knotwork.workspaces.models import WorkspaceMember

router = APIRouter(tags=["invitations"])


@router.post("/workspaces/{workspace_id}/invitations", response_model=InvitationOut)
async def create_invitation(
    workspace_id: UUID,
    req: CreateInvitationRequest,
    _member: WorkspaceMember = Depends(require_owner),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InvitationOut:
    """Owner invites a new user by email. Sends a magic link email."""
    return await service.create_invitation(db, workspace_id, user.id, req)


@router.get("/workspaces/{workspace_id}/invitations", response_model=list[InvitationOut])
async def list_invitations(
    workspace_id: UUID,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> list[InvitationOut]:
    """List all invitations for the workspace (owner only)."""
    return await service.list_invitations(db, workspace_id)


# ── Public invitation endpoints (no JWT required) ─────────────────────────────

public_router = APIRouter(prefix="/auth", tags=["invitations"])


@public_router.get("/invitations/{token}", response_model=InvitationVerifyOut)
async def verify_invitation(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> InvitationVerifyOut:
    """Verify an invitation token and return workspace info (public endpoint)."""
    return await service.get_invitation_by_token(db, token)


@public_router.post("/invitations/{token}/accept", response_model=AcceptInvitationOut)
async def accept_invitation(
    token: str,
    req: AcceptInvitationRequest,
    db: AsyncSession = Depends(get_db),
) -> AcceptInvitationOut:
    """Accept an invitation: creates account + workspace member, returns JWT."""
    return await service.accept_invitation(db, token, req.name)

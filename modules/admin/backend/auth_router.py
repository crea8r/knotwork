"""Auth endpoints: magic link request/verify, current user."""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from libs.config import settings
from libs.database import get_db
from modules.communication.backend.notification_channels.email import send as send_email
from libs.auth.backend import service
from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User
from .workspaces_models import Workspace, WorkspaceMember

router = APIRouter(prefix="/auth", tags=["auth"])


class AgentChallengeRequest(BaseModel):
    public_key: str = Field(..., description="Agent's ed25519 public key (base64url)")


class AgentChallengeResponse(BaseModel):
    nonce: str
    expires_at: str


class AgentTokenRequest(BaseModel):
    public_key: str
    nonce: str
    signature: str = Field(..., description="base64url(ed25519_sign(private_key, nonce.encode()))")


class MagicLinkRequest(BaseModel):
    email: EmailStr


class MagicLinkVerifyRequest(BaseModel):
    token: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: str | None = None
    name: str
    bio: str | None = None
    avatar_url: str | None = None


class UpdateMeRequest(BaseModel):
    name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None


class LocalhostSwitchUserRequest(BaseModel):
    user_id: str


class LocalhostSwitchUserResponse(BaseModel):
    detail: str
    email: str


def _workspace_email_from(workspace: Workspace) -> str:
    return (workspace.email_from or settings.email_from).strip() or settings.email_from


async def _has_active_workspace_membership(db: AsyncSession, user_id: UUID) -> bool:
    result = await db.execute(
        select(WorkspaceMember.id)
        .where(
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.access_disabled_at.is_(None),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


@router.post("/agent-challenge", response_model=AgentChallengeResponse, status_code=201)
async def request_agent_challenge(
    req: AgentChallengeRequest,
    db: AsyncSession = Depends(get_db),
) -> AgentChallengeResponse:
    """Step 1 of agent auth: request a nonce to sign with the agent's ed25519 private key."""
    user = await service.get_user_by_public_key(db, req.public_key)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No agent account for this public key")
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access disabled")
    nonce, expires_at = await service.create_agent_challenge(db, req.public_key)
    await db.commit()
    return AgentChallengeResponse(nonce=nonce, expires_at=expires_at.isoformat())


@router.post("/agent-token", response_model=TokenResponse)
async def verify_agent_token(
    req: AgentTokenRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Step 2 of agent auth: submit signed nonce, receive a JWT bearer token."""
    user = await service.verify_agent_challenge(db, req.public_key, req.nonce, req.signature)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid challenge response")
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access disabled")
    await db.commit()
    return TokenResponse(access_token=service.create_access_token(user.id))


@router.post("/magic-link-request", status_code=202)
async def request_magic_link(
    req: MagicLinkRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send a magic link login email to an existing user.

    Returns 404 if the email is not registered — the user needs an invitation first.
    """
    email = req.email.lower().strip()
    user = await service.get_user_by_email(db, email)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found for this email. Ask your workspace owner for an invitation.",
        )
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access disabled. Ask your workspace owner to re-enable your membership.",
        )

    token_str = await service.create_magic_link_token(db, user)
    await db.commit()

    login_url = f"{settings.normalized_frontend_url}/accept-invite?magic={token_str}"
    body = (
        f"Click the link below to log in to Knotwork (expires in 15 minutes):\n\n"
        f"{login_url}\n\n"
        f"If you didn't request this, you can safely ignore it."
    )
    try:
        await send_email(
            to_address=email,
            subject="Your Knotwork login link",
            body=body,
            from_address=settings.email_from,
        )
    except Exception as exc:
        logger.error("Magic link email failed for %s: %s", email, exc)

    return {"detail": "If that email is registered, a link has been sent."}


@router.post("/magic-link-verify", response_model=TokenResponse)
async def verify_magic_link(
    req: MagicLinkVerifyRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Exchange a magic link token for a JWT access token."""
    user = await service.consume_magic_link_token(db, req.token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Magic link is invalid or has expired",
        )
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access disabled. Ask your workspace owner to re-enable your membership.",
        )
    await db.commit()
    return TokenResponse(access_token=service.create_access_token(user.id))


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        bio=user.bio,
        avatar_url=user.avatar_url,
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    """Return the current authenticated user."""
    return _user_out(user)


@router.patch("/me", response_model=UserOut)
async def update_me(
    req: UpdateMeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    """Update the current user's profile (name, bio, avatar_url)."""
    if req.name is not None:
        user.name = req.name.strip() or user.name
    if req.bio is not None:
        user.bio = req.bio.strip() or None
    if req.avatar_url is not None:
        user.avatar_url = req.avatar_url.strip() or None
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_out(user)


@router.post(
    "/localhost/workspaces/{workspace_id}/switch-user-request",
    response_model=LocalhostSwitchUserResponse,
    status_code=202,
)
async def request_localhost_switch_user(
    workspace_id: str,
    req: LocalhostSwitchUserRequest,
    _member: WorkspaceMember = Depends(get_workspace_member),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LocalhostSwitchUserResponse:
    if not settings.is_local_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    try:
        workspace_uuid = UUID(workspace_id)
        target_user_id = UUID(req.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid id") from exc

    workspace = await db.get(Workspace, workspace_uuid)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if not (workspace.resend_api_key or "").strip():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Workspace email is not configured.",
        )

    member_count = await db.scalar(
        select(func.count()).where(
            WorkspaceMember.workspace_id == workspace_uuid,
            WorkspaceMember.access_disabled_at.is_(None),
        )
    )
    if (member_count or 0) < 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Localhost switching requires at least two workspace members.",
        )

    target_row = await db.execute(
        select(User)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(
            WorkspaceMember.workspace_id == workspace_uuid,
            WorkspaceMember.access_disabled_at.is_(None),
            User.id == target_user_id,
        )
        .limit(1)
    )
    target_user = target_row.scalar_one_or_none()
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in workspace")
    if not (target_user.email or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target user has no email")

    token_str = await service.create_magic_link_token(db, target_user)
    await db.commit()

    login_url = f"{settings.normalized_frontend_url}/accept-invite?magic={token_str}"
    body = (
        f"Click the link below to switch into the Knotwork localhost session for {workspace.name}.\n\n"
        f"{login_url}\n\n"
        f"The link expires in 15 minutes."
    )
    try:
        await send_email(
            to_address=target_user.email,
            subject=f"Switch user for {workspace.name}",
            body=body,
            from_address=_workspace_email_from(workspace),
            api_key=workspace.resend_api_key,
        )
    except Exception as exc:
        logger.error("Localhost switch email failed for %s: %s", target_user.email, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Switch email could not be delivered.",
        ) from exc

    return LocalhostSwitchUserResponse(
        detail="Magic link sent.",
        email=target_user.email,
    )


@router.post("/logout", status_code=204)
async def logout() -> None:
    """Logout is client-side: discard the JWT. Server-side is a no-op."""

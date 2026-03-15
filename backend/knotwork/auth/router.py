"""Auth endpoints: magic link request/verify, current user."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from knotwork.auth import service
from knotwork.auth.deps import get_current_user
from knotwork.auth.models import User
from knotwork.config import settings
from knotwork.database import get_db
from knotwork.notifications.channels.email import send as send_email

router = APIRouter(prefix="/auth", tags=["auth"])


class MagicLinkRequest(BaseModel):
    email: EmailStr


class MagicLinkVerifyRequest(BaseModel):
    token: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    bio: str | None = None
    avatar_url: str | None = None


class UpdateMeRequest(BaseModel):
    name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None


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


@router.post("/logout", status_code=204)
async def logout() -> None:
    """Logout is client-side: discard the JWT. Server-side is a no-op."""

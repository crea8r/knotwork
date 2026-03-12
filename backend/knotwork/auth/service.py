"""Auth service: JWT creation/verification and magic link token management."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.models import User, UserMagicToken
from knotwork.config import settings

_MAGIC_TOKEN_TTL_MINUTES = 15
_SESSION_TOKEN_TTL_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── JWT ────────────────────────────────────────────────────────────────────────

def create_access_token(user_id: UUID, extra: dict[str, Any] | None = None) -> str:
    """Return a signed JWT for the given user."""
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "exp": _now() + timedelta(days=_SESSION_TOKEN_TTL_DAYS),
        "iat": _now(),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decode and verify a JWT. Returns payload dict or None on failure."""
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


# ── User lookup ────────────────────────────────────────────────────────────────

async def get_user_by_id(db: AsyncSession, user_id: UUID) -> User | None:
    return await db.get(User, user_id)


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email.lower().strip()))
    return result.scalar_one_or_none()


async def get_or_create_user(
    db: AsyncSession, email: str, name: str
) -> tuple[User, bool]:
    """Return (user, created). Upsert by email — name updated if already exists."""
    email = email.lower().strip()
    user = await get_user_by_email(db, email)
    if user is not None:
        return user, False
    user = User(email=email, name=name, hashed_password="!no-password")
    db.add(user)
    await db.flush()
    return user, True


# ── Magic link tokens ──────────────────────────────────────────────────────────

def _new_magic_token() -> str:
    return secrets.token_urlsafe(32)


async def create_magic_link_token(db: AsyncSession, user: User) -> str:
    """Mint a one-time magic link token (15 min TTL). Returns the raw token string."""
    token_str = _new_magic_token()
    row = UserMagicToken(
        user_id=user.id,
        token=token_str,
        expires_at=_now() + timedelta(minutes=_MAGIC_TOKEN_TTL_MINUTES),
        used=False,
    )
    db.add(row)
    await db.flush()
    return token_str


async def consume_magic_link_token(
    db: AsyncSession, token_str: str
) -> User | None:
    """Verify and consume a magic link token. Returns the User if valid, else None."""
    result = await db.execute(
        select(UserMagicToken).where(UserMagicToken.token == token_str)
    )
    row: UserMagicToken | None = result.scalar_one_or_none()
    if row is None or row.used:
        return None
    # Compare in a timezone-safe way: SQLite may return naive datetimes even
    # when the column is declared DateTime(timezone=True).
    expires_at = row.expires_at
    now_dt = _now()
    if expires_at.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=None)
    if expires_at < now_dt:
        return None
    row.used = True
    user = await db.get(User, row.user_id)
    await db.flush()
    return user

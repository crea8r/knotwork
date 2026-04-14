"""Auth service: JWT creation/verification, password login, magic link, and agent auth."""
from __future__ import annotations

import base64
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AgentAuthChallenge, User, UserMagicToken, UserPasswordResetToken
from libs.config import settings

_MAGIC_TOKEN_TTL_MINUTES = 15
_PASSWORD_RESET_TOKEN_TTL_MINUTES = 30
_SESSION_TOKEN_TTL_DAYS = 30
_MIN_PASSWORD_LENGTH = 4
_pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


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


def _normalize_email(email: str) -> str:
    return email.lower().strip()


def validate_password(password: str) -> str:
    normalized = password.strip()
    if len(normalized) < _MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {_MIN_PASSWORD_LENGTH} characters")
    return normalized


def hash_password(password: str) -> str:
    return _pwd_context.hash(validate_password(password))


def password_is_usable(hashed_password: str | None) -> bool:
    return bool(hashed_password) and not hashed_password.startswith("!")


def verify_password(password: str, hashed_password: str) -> bool:
    if not password_is_usable(hashed_password):
        return False
    try:
        return _pwd_context.verify(password, hashed_password)
    except Exception:
        return False


def set_user_password(user: User, password: str, *, must_change_password: bool = False) -> None:
    user.hashed_password = hash_password(password)
    user.must_change_password = must_change_password


async def get_or_create_user(
    db: AsyncSession, email: str, name: str
) -> tuple[User, bool]:
    """Return (user, created). Upsert by email — name updated if already exists."""
    email = _normalize_email(email)
    user = await get_user_by_email(db, email)
    if user is not None:
        return user, False
    user = User(email=email, name=name, hashed_password="!no-password")
    db.add(user)
    await db.flush()
    return user, True


# ── Password auth ──────────────────────────────────────────────────────────────

async def authenticate_user_by_password(
    db: AsyncSession,
    email: str,
    password: str,
) -> User | None:
    user = await get_user_by_email(db, _normalize_email(email))
    if user is None or not user.email:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def _new_token() -> str:
    return secrets.token_urlsafe(32)


async def create_password_reset_token(db: AsyncSession, user: User) -> str:
    token_str = _new_token()
    row = UserPasswordResetToken(
        user_id=user.id,
        token=token_str,
        expires_at=_now() + timedelta(minutes=_PASSWORD_RESET_TOKEN_TTL_MINUTES),
        used=False,
    )
    db.add(row)
    await db.flush()
    return token_str


async def consume_password_reset_token(db: AsyncSession, token_str: str) -> User | None:
    result = await db.execute(
        select(UserPasswordResetToken).where(UserPasswordResetToken.token == token_str)
    )
    row: UserPasswordResetToken | None = result.scalar_one_or_none()
    if row is None or row.used:
        return None
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


# ── Magic link tokens ──────────────────────────────────────────────────────────

def _new_magic_token() -> str:
    return _new_token()


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


async def get_user_by_public_key(db: AsyncSession, public_key: str) -> User | None:
    result = await db.execute(select(User).where(User.public_key == public_key))
    return result.scalar_one_or_none()


# ── Agent challenge-response auth ──────────────────────────────────────────────

_CHALLENGE_TTL_SECONDS = 120  # nonces expire after 2 minutes


async def create_agent_challenge(db: AsyncSession, public_key: str) -> tuple[str, datetime]:
    """Mint a one-time nonce for the agent to sign. Returns (nonce, expires_at)."""
    nonce = secrets.token_urlsafe(32)
    expires_at = _now() + timedelta(seconds=_CHALLENGE_TTL_SECONDS)
    row = AgentAuthChallenge(public_key=public_key, nonce=nonce, expires_at=expires_at, used=False)
    db.add(row)
    await db.flush()
    return nonce, expires_at


async def verify_agent_challenge(
    db: AsyncSession,
    public_key: str,
    nonce: str,
    signature: str,
) -> User | None:
    """Verify a signed nonce. Consumes the challenge and returns the User on success."""
    result = await db.execute(
        select(AgentAuthChallenge).where(
            AgentAuthChallenge.nonce == nonce,
            AgentAuthChallenge.public_key == public_key,
        )
    )
    row: AgentAuthChallenge | None = result.scalar_one_or_none()
    if row is None or row.used:
        return None
    expires_at = row.expires_at
    now_dt = _now()
    if expires_at.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=None)
    if expires_at < now_dt:
        return None

    # Verify ed25519 signature
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        raw_key = base64.urlsafe_b64decode(public_key + "==")
        pub = Ed25519PublicKey.from_public_bytes(raw_key)
        sig_bytes = base64.urlsafe_b64decode(signature + "==")
        pub.verify(sig_bytes, nonce.encode())
    except Exception:
        return None

    row.used = True
    user = await get_user_by_public_key(db, public_key)
    await db.flush()
    return user


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

from datetime import datetime
from uuid import uuid4
from sqlalchemy import String, DateTime, ForeignKey, Boolean, Index
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from libs.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    # Nullable for agent accounts (no email login). Unique where not null.
    email: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Magic-link auth: password is unused but kept for schema compatibility.
    # Invited users receive hashed_password="!no-password" (unusable hash).
    hashed_password: Mapped[str] = mapped_column(String, nullable=False, default="!no-password")
    # Ed25519 public key (base64url) for agent challenge-response auth. Null for humans.
    public_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    whatsapp_number: Mapped[str | None] = mapped_column(String, nullable=True)
    bio: Mapped[str | None] = mapped_column(String(300), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class UserMagicToken(Base):
    """One-time login tokens sent via magic link email (15-min TTL)."""
    __tablename__ = "user_magic_tokens"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AgentAuthChallenge(Base):
    """Short-lived nonce issued to an agent during ed25519 challenge-response auth (2-min TTL)."""
    __tablename__ = "agent_auth_challenges"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    # The agent's public key — used to look up the User row on verify.
    public_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # Random nonce the agent must sign with its private key.
    nonce: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

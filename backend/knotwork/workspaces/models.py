from uuid import uuid4
from sqlalchemy import String, Integer, JSON, DateTime, ForeignKey, Text, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from knotwork.database import Base


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    default_model: Mapped[str] = mapped_column(String, nullable=False, default="openai/gpt-4o")
    resend_api_key: Mapped[str | None] = mapped_column(String, nullable=True)
    email_from: Mapped[str | None] = mapped_column(String, nullable=True)
    token_count_min: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    token_count_max: Mapped[int] = mapped_column(Integer, nullable=False, default=6000)
    # Workspace guide — human-authored rulebook visible to all participants (human + agent).
    # Agents fetch this at startup and re-fetch when guide_version increments.
    guide_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    guide_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    # Always present — agents have their own User row (no email, uses public_key auth).
    user_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False, default="operator")
    # 'human' | 'agent' — mirrors the auth method on the associated User.
    kind: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'human'"))
    # Agent-specific metadata (provider, agent_ref, last_heartbeat, etc.). Null for humans.
    agent_config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    notification_prefs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

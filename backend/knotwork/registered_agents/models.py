"""RegisteredAgent ORM model — workspace-scoped agent credential store."""
from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from knotwork.database import Base


class RegisteredAgent(Base):
    __tablename__ = "registered_agents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    display_name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    # 'anthropic' | 'openai' | 'openclaw'
    provider: Mapped[str] = mapped_column(sa.String(50), nullable=False)
    # e.g. "anthropic:claude-sonnet-4-6", "openai:gpt-4o", "openclaw:my-agent"
    agent_ref: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    # Plaintext for MVP; null for openclaw (future protocol TBD)
    api_key: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    # Future: openclaw endpoint URL
    endpoint: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    # S8 lifecycle status: inactive | active | archived
    status: Mapped[str] = mapped_column(
        sa.String(50), nullable=False, server_default=sa.text("'inactive'")
    )
    # S8 auth metadata (ciphertext storage handled by service layer)
    credential_type: Mapped[str | None] = mapped_column(sa.String(50), nullable=True)
    credential_ciphertext: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    credential_hint: Mapped[str | None] = mapped_column(sa.String(100), nullable=True)

    # S8 capability metadata
    capability_version: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    capability_hash: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    capability_refreshed_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    capability_freshness: Mapped[str] = mapped_column(
        sa.String(30), nullable=False, server_default=sa.text("'needs_refresh'")
    )

    last_used_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        sa.DateTime(timezone=True), nullable=True
    )
    # Workspace-facing description of what this agent does
    bio: Mapped[str | None] = mapped_column(sa.Text, nullable=True)

    # OpenClaw plugin-first binding metadata
    openclaw_integration_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    openclaw_remote_agent_id: Mapped[str | None] = mapped_column(
        sa.String(200), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgentCapabilitySnapshot(Base):
    __tablename__ = "agent_capability_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        sa.ForeignKey("registered_agents.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    hash: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    source: Mapped[str] = mapped_column(
        sa.String(30), nullable=False, server_default=sa.text("'refresh'")
    )
    tools_json: Mapped[list] = mapped_column(sa.JSON, nullable=False, default=list)
    constraints_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    policy_notes_json: Mapped[list] = mapped_column(sa.JSON, nullable=False, default=list)
    raw_contract_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    changed_from_previous: Mapped[bool] = mapped_column(
        sa.Boolean, nullable=False, server_default=sa.text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=func.now(), nullable=False
    )



from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from knotwork.database import Base


class OpenClawHandshakeToken(Base):
    __tablename__ = "openclaw_handshake_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(sa.String(120), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=func.now(), nullable=False)


class OpenClawIntegration(Base):
    __tablename__ = "openclaw_integrations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    plugin_instance_id: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    openclaw_workspace_id: Mapped[str | None] = mapped_column(sa.String(200), nullable=True)
    plugin_version: Mapped[str | None] = mapped_column(sa.String(100), nullable=True)
    integration_secret: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    status: Mapped[str] = mapped_column(sa.String(30), nullable=False, server_default=sa.text("'connected'"))
    connected_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    metadata_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=func.now(), nullable=False)


class OpenClawRemoteAgent(Base):
    __tablename__ = "openclaw_remote_agents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("openclaw_integrations.id", ondelete="CASCADE"), nullable=False
    )
    remote_agent_id: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    slug: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    display_name: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    # Short description of the agent (sent by plugin on handshake; optional)
    description: Mapped[str | None] = mapped_column(sa.String(500), nullable=True)
    tools_json: Mapped[list] = mapped_column(sa.JSON, nullable=False, default=list)
    constraints_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"))
    last_synced_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=func.now(), nullable=False)


class OpenClawExecutionTask(Base):
    __tablename__ = "openclaw_execution_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("openclaw_integrations.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=True
    )
    node_id: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    agent_ref: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    remote_agent_id: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    system_prompt: Mapped[str] = mapped_column(sa.Text, nullable=False)
    user_prompt: Mapped[str] = mapped_column(sa.Text, nullable=False)
    session_token: Mapped[str] = mapped_column(sa.Text, nullable=False)
    status: Mapped[str] = mapped_column(
        sa.String(30), nullable=False, server_default=sa.text("'pending'")
    )
    claimed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    output_text: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    next_branch: Mapped[str | None] = mapped_column(sa.String(120), nullable=True)
    escalation_question: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    escalation_options_json: Mapped[list] = mapped_column(sa.JSON, nullable=False, default=list)
    attachments_json: Mapped[list] = mapped_column(sa.JSON, nullable=False, default=list)
    error_message: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=func.now(), nullable=False)


class OpenClawExecutionEvent(Base):
    __tablename__ = "openclaw_execution_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("openclaw_execution_tasks.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(sa.String(80), nullable=False)
    payload_json: Mapped[dict] = mapped_column(sa.JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), server_default=func.now(), nullable=False)

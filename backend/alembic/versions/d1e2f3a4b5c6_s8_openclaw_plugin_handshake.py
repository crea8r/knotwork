"""s8_openclaw_plugin_handshake

Revision ID: d1e2f3a4b5c6
Revises: c8d9e0f1a2b3
Create Date: 2026-03-05 19:20:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "openclaw_handshake_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(length=120), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_openclaw_handshake_tokens_workspace", "openclaw_handshake_tokens", ["workspace_id"])

    op.create_table(
        "openclaw_integrations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plugin_instance_id", sa.String(length=200), nullable=False),
        sa.Column("openclaw_workspace_id", sa.String(length=200), nullable=True),
        sa.Column("plugin_version", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default=sa.text("'connected'")),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_openclaw_integrations_workspace", "openclaw_integrations", ["workspace_id"])
    op.create_index(
        "ux_openclaw_integrations_workspace_plugin",
        "openclaw_integrations",
        ["workspace_id", "plugin_instance_id"],
        unique=True,
    )

    op.create_table(
        "openclaw_remote_agents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("integration_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("remote_agent_id", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=200), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("tools_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("constraints_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["integration_id"], ["openclaw_integrations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_openclaw_remote_agents_workspace", "openclaw_remote_agents", ["workspace_id"])
    op.create_index(
        "ux_openclaw_remote_agents_unique",
        "openclaw_remote_agents",
        ["workspace_id", "integration_id", "remote_agent_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_openclaw_remote_agents_unique", table_name="openclaw_remote_agents")
    op.drop_index("ix_openclaw_remote_agents_workspace", table_name="openclaw_remote_agents")
    op.drop_table("openclaw_remote_agents")

    op.drop_index("ux_openclaw_integrations_workspace_plugin", table_name="openclaw_integrations")
    op.drop_index("ix_openclaw_integrations_workspace", table_name="openclaw_integrations")
    op.drop_table("openclaw_integrations")

    op.drop_index("ix_openclaw_handshake_tokens_workspace", table_name="openclaw_handshake_tokens")
    op.drop_table("openclaw_handshake_tokens")

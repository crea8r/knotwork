"""knowledge change actions

Revision ID: 0030
Revises: 0029_knowledge_change_channel
Create Date: 2026-04-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_changes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("node_id", sa.String(length=200), nullable=True),
        sa.Column("agent_ref", sa.String(), nullable=True),
        sa.Column("action_type", sa.String(length=40), nullable=False),
        sa.Column("target_type", sa.String(length=40), nullable=False),
        sa.Column("target_path", sa.String(), nullable=False),
        sa.Column("proposed_content", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("final_content", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    op.execute(
        """
        INSERT INTO knowledge_changes (
            id, workspace_id, project_id, channel_id, run_id, node_id, agent_ref,
            action_type, target_type, target_path, proposed_content, payload, reason,
            status, reviewed_by, reviewed_at, final_content, created_at
        )
        SELECT
            p.id,
            c.workspace_id,
            NULL,
            p.channel_id,
            p.run_id,
            p.node_id,
            p.agent_ref,
            'update_content',
            'file',
            p.path,
            p.proposed_content,
            '{}'::json,
            p.reason,
            p.status,
            p.reviewed_by,
            p.reviewed_at,
            p.final_content,
            p.created_at
        FROM run_handbook_proposals p
        JOIN channels c ON c.id = p.channel_id
        WHERE p.channel_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_table("knowledge_changes")

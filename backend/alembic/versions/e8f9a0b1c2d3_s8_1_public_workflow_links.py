"""s8.1 public workflow links and public run shares

Revision ID: e8f9a0b1c2d3
Revises: c1d2e3f4a5b6
Create Date: 2026-03-12 00:00:00.000000
"""
from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e8f9a0b1c2d3"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "public_workflow_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("graph_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("graph_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("token", sa.String(length=120), nullable=False),
        sa.Column("description_md", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'active'"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["graph_id"], ["graphs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["graph_version_id"], ["graph_versions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index(
        "ix_public_workflow_links_workspace_graph_status",
        "public_workflow_links",
        ["workspace_id", "graph_id", "status"],
    )

    op.create_table(
        "public_run_shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("public_workflow_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(length=120), nullable=False),
        sa.Column("description_md", sa.Text(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["public_workflow_id"], ["public_workflow_links.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index(
        "ix_public_run_shares_run_email_notified",
        "public_run_shares",
        ["run_id", "email", "notified_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_public_run_shares_run_email_notified", table_name="public_run_shares")
    op.drop_table("public_run_shares")
    op.drop_index("ix_public_workflow_links_workspace_graph_status", table_name="public_workflow_links")
    op.drop_table("public_workflow_links")

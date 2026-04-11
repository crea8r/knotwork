"""add workspace member profile status

Revision ID: 0036_member_profile_status
Revises: 0035_member_brief
Create Date: 2026-04-08
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0036_member_profile_status"
down_revision = "0035_member_brief"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_members",
        sa.Column("availability_status", sa.String(length=30), server_default="available", nullable=False),
    )
    op.add_column(
        "workspace_members",
        sa.Column("capacity_level", sa.String(length=30), server_default="open", nullable=False),
    )
    op.add_column("workspace_members", sa.Column("status_note", sa.Text(), nullable=True))
    op.add_column("workspace_members", sa.Column("current_commitments", sa.JSON(), nullable=True))
    op.add_column("workspace_members", sa.Column("recent_work", sa.JSON(), nullable=True))
    op.add_column("workspace_members", sa.Column("status_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("workspace_members", "status_updated_at")
    op.drop_column("workspace_members", "recent_work")
    op.drop_column("workspace_members", "current_commitments")
    op.drop_column("workspace_members", "status_note")
    op.drop_column("workspace_members", "capacity_level")
    op.drop_column("workspace_members", "availability_status")

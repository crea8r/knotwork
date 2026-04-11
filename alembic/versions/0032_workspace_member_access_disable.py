"""add workspace member access disabled flag

Revision ID: 0032_member_access_disable
Revises: 0031_rename_plugin_to_push
Create Date: 2026-04-04
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0032_member_access_disable"
down_revision = "0031_rename_plugin_to_push"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_members",
        sa.Column("access_disabled_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("workspace_members", "access_disabled_at")

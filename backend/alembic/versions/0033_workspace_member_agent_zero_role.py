"""add workspace member agent zero role

Revision ID: 0033_member_agent_zero_role
Revises: 0032_member_access_disable
Create Date: 2026-04-08
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0033_member_agent_zero_role"
down_revision = "0032_member_access_disable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_members",
        sa.Column("agent_zero_role", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("workspace_members", "agent_zero_role")

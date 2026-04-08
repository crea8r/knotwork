"""add workspace member contribution brief

Revision ID: 0035_member_brief
Revises: 0034_one_agent_zero
Create Date: 2026-04-08
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0035_member_brief"
down_revision = "0034_one_agent_zero"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workspace_members", sa.Column("contribution_brief", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("workspace_members", "contribution_brief")

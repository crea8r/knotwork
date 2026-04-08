"""enforce one agent zero per workspace

Revision ID: 0034_one_agent_zero
Revises: 0033_member_agent_zero_role
Create Date: 2026-04-08
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0034_one_agent_zero"
down_revision = "0033_member_agent_zero_role"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                row_number() OVER (PARTITION BY workspace_id ORDER BY created_at ASC, id ASC) AS rn
            FROM workspace_members
            WHERE agent_zero_role = true
        )
        UPDATE workspace_members
        SET agent_zero_role = false
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
        """
    )
    op.create_index(
        "uq_workspace_members_one_agent_zero",
        "workspace_members",
        ["workspace_id"],
        unique=True,
        postgresql_where=sa.text("agent_zero_role = true"),
    )


def downgrade() -> None:
    op.drop_index("uq_workspace_members_one_agent_zero", table_name="workspace_members")

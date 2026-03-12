"""chat attachments on openclaw_execution_tasks

Revision ID: c1d2e3f4a5b6
Revises: f1e2d3c4b5a6
Create Date: 2026-03-11 00:00:00.000000
"""
from __future__ import annotations
from typing import Union
import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "openclaw_execution_tasks",
        sa.Column("attachments_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("openclaw_execution_tasks", "attachments_json")

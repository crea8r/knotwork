"""s8_1: add description to openclaw_remote_agents

Revision ID: f1e2d3c4b5a6
Revises: a9b8c7d6e5f4
Create Date: 2026-03-09 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f1e2d3c4b5a6"
down_revision: Union[str, None] = "a9b8c7d6e5f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "openclaw_remote_agents",
        sa.Column("description", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("openclaw_remote_agents", "description")

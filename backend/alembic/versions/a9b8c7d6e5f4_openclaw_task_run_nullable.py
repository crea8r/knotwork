"""openclaw_task_run_nullable

Revision ID: a9b8c7d6e5f4
Revises: e3f4a5b6c7d8
Create Date: 2026-03-06 18:35:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "a9b8c7d6e5f4"
down_revision: Union[str, None] = "e3f4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "openclaw_execution_tasks",
        "run_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM openclaw_execution_tasks WHERE run_id IS NULL"
    )
    op.alter_column(
        "openclaw_execution_tasks",
        "run_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )


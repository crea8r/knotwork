"""add_error_to_runs

Revision ID: 4d76d0df12a9
Revises: 99138170d563
Create Date: 2026-03-02 09:41:22.805752

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '4d76d0df12a9'
down_revision: Union[str, None] = '99138170d563'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('runs', sa.Column('error', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('runs', 'error')

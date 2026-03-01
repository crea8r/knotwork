"""s6.2: add name column to runs table

Revision ID: c3d4e5f6a7b8
Revises: 85a3c3676caf
Create Date: 2026-03-01 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = '85a3c3676caf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('runs', sa.Column('name', sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column('runs', 'name')

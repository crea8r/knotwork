"""add_agent_bio

Revision ID: 0002_add_agent_bio
Revises: 0001_initial_clean
Create Date: 2026-03-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002_add_agent_bio'
down_revision: Union[str, None] = '0001_initial_clean'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'registered_agents',
        sa.Column('bio', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('registered_agents', 'bio')

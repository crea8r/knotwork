"""s7_1_registered_agents

Revision ID: a1b2c3d4e5f6
Revises: b8e3f1a2c4d5
Create Date: 2026-03-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'b8e3f1a2c4d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'registered_agents',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('workspace_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('display_name', sa.String(200), nullable=False),
        sa.Column('provider', sa.String(50), nullable=False),
        sa.Column('agent_ref', sa.String(200), nullable=False),
        sa.Column('api_key', sa.Text(), nullable=True),
        sa.Column('endpoint', sa.String(500), nullable=True),
        sa.Column(
            'is_active', sa.Boolean(), nullable=False,
            server_default=sa.text('true'),
        ),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('now()'), nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(
            ['workspace_id'], ['workspaces.id'], ondelete='CASCADE'
        ),
    )
    op.create_index(
        'ix_registered_agents_workspace_id',
        'registered_agents',
        ['workspace_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_registered_agents_workspace_id', table_name='registered_agents')
    op.drop_table('registered_agents')

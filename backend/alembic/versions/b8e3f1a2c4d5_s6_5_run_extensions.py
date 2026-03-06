"""s6_5_run_extensions

Revision ID: b8e3f1a2c4d5
Revises: 4d76d0df12a9
Create Date: 2026-03-02 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b8e3f1a2c4d5'
down_revision: Union[str, None] = '4d76d0df12a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Extend run_node_states with S6.5 agent fields
    op.add_column('run_node_states', sa.Column('node_name', sa.String(), nullable=True))
    op.add_column('run_node_states', sa.Column('agent_ref', sa.String(), nullable=True))
    op.add_column('run_node_states', sa.Column(
        'agent_logs', postgresql.JSON(astext_type=sa.Text()), nullable=False,
        server_default='[]',
    ))
    op.add_column('run_node_states', sa.Column('next_branch', sa.String(), nullable=True))

    # Create run_worklog_entries table
    op.create_table(
        'run_worklog_entries',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('node_id', sa.String(), nullable=False),
        sa.Column('agent_ref', sa.String(), nullable=True),
        sa.Column('entry_type', sa.String(), nullable=False, server_default='observation'),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('metadata', postgresql.JSON(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['run_id'], ['runs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_run_worklog_entries_run_id', 'run_worklog_entries', ['run_id'])

    # Create run_handbook_proposals table
    op.create_table(
        'run_handbook_proposals',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('node_id', sa.String(), nullable=False),
        sa.Column('agent_ref', sa.String(), nullable=True),
        sa.Column('path', sa.String(), nullable=False),
        sa.Column('proposed_content', sa.Text(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('reviewed_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('final_content', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['run_id'], ['runs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_run_handbook_proposals_run_id', 'run_handbook_proposals', ['run_id'])


def downgrade() -> None:
    op.drop_table('run_handbook_proposals')
    op.drop_table('run_worklog_entries')
    op.drop_column('run_node_states', 'next_branch')
    op.drop_column('run_node_states', 'agent_logs')
    op.drop_column('run_node_states', 'agent_ref')
    op.drop_column('run_node_states', 'node_name')

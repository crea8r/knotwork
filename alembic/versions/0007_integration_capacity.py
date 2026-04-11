"""add tasks_running and slots_available to openclaw_integrations

Revision ID: 0007_integration_capacity
Revises: 0006_short_run_ids
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa

revision = '0007_integration_capacity'
down_revision = '0006_short_run_ids'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('openclaw_integrations', sa.Column('tasks_running', sa.Integer(), nullable=True))
    op.add_column('openclaw_integrations', sa.Column('slots_available', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('openclaw_integrations', 'slots_available')
    op.drop_column('openclaw_integrations', 'tasks_running')

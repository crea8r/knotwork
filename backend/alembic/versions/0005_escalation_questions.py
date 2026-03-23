"""escalation_questions_json array on openclaw_execution_tasks

Revision ID: 0005_escalation_questions
Revises: 0004_remove_preflight
Create Date: 2026-03-21 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = '0005_escalation_questions'
down_revision = '0004_remove_preflight'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'openclaw_execution_tasks',
        sa.Column('escalation_questions_json', sa.JSON(), nullable=False, server_default='[]'),
    )


def downgrade() -> None:
    op.drop_column('openclaw_execution_tasks', 'escalation_questions_json')

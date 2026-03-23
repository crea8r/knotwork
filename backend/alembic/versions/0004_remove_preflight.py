"""remove_preflight

Revision ID: 0004_remove_preflight
Revises: 0003_openclaw_integration_unique
Create Date: 2026-03-20 00:00:00.000000

Drop the agent preflight system (now obsolete):
- Activate all inactive OpenClaw registered agents (handshake IS the validation).
- Drop agent_preflight_tests and agent_preflight_runs tables.
- Drop preflight_status, preflight_run_at, baseline_preflight_run_id columns
  from registered_agents.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0004_remove_preflight'
down_revision: Union[str, None] = '0003_openclaw_integration_unique'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Activate all OpenClaw agents that were stuck as inactive.
    op.execute(
        """
        UPDATE registered_agents
        SET status = 'active', is_active = TRUE
        WHERE provider = 'openclaw'
          AND status = 'inactive'
        """
    )

    # 2. Drop preflight tables (child first to respect FK constraints).
    op.drop_table('agent_preflight_tests')
    op.drop_table('agent_preflight_runs')

    # 3. Drop preflight columns from registered_agents.
    op.drop_column('registered_agents', 'baseline_preflight_run_id')
    op.drop_column('registered_agents', 'preflight_run_at')
    op.drop_column('registered_agents', 'preflight_status')


def downgrade() -> None:
    # Restore preflight columns (tables are not recreated — data is gone).
    op.add_column(
        'registered_agents',
        sa.Column('preflight_status', sa.String(30), nullable=False,
                  server_default=sa.text("'never_run'")),
    )
    op.add_column(
        'registered_agents',
        sa.Column('preflight_run_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'registered_agents',
        sa.Column('baseline_preflight_run_id', sa.UUID(), nullable=True),
    )

"""openclaw_integration_unique

Revision ID: 0003_openclaw_integration_unique
Revises: 0002_add_agent_bio
Create Date: 2026-03-20 00:00:00.000000

Prevent duplicate integrations for the same plugin_instance_id within a workspace.
Concurrent handshake calls (e.g. two poll ticks both hitting 401 simultaneously)
previously inserted two rows since there was no DB-level uniqueness guard.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '0003_openclaw_integration_unique'
down_revision: Union[str, None] = '0002_add_agent_bio'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        'uq_openclaw_integrations_workspace_instance',
        'openclaw_integrations',
        ['workspace_id', 'plugin_instance_id'],
    )


def downgrade() -> None:
    op.drop_constraint(
        'uq_openclaw_integrations_workspace_instance',
        'openclaw_integrations',
        type_='unique',
    )

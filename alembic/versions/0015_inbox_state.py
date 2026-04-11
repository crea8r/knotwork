"""s10 inbox state

Revision ID: 0015_inbox_state
Revises: 0014_workspace_email
Create Date: 2026-03-26
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_inbox_state"
down_revision = "0014_workspace_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("event_deliveries", sa.Column("read_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("event_deliveries", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("event_deliveries", "archived_at")
    op.drop_column("event_deliveries", "read_at")

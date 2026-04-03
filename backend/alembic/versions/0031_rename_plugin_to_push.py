"""rename plugin delivery to push

Revision ID: 0031_rename_plugin_to_push
Revises: 0030
Create Date: 2026-04-03
"""
from __future__ import annotations

from alembic import op

revision = "0031_rename_plugin_to_push"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rename column in participant_delivery_preferences
    op.alter_column("participant_delivery_preferences", "plugin_enabled", new_column_name="push_enabled")

    # Update existing delivery_mean values from 'plugin' to 'push'
    op.execute("UPDATE event_deliveries SET delivery_mean = 'push' WHERE delivery_mean = 'plugin'")


def downgrade() -> None:
    op.execute("UPDATE event_deliveries SET delivery_mean = 'plugin' WHERE delivery_mean = 'push'")
    op.alter_column("participant_delivery_preferences", "push_enabled", new_column_name="plugin_enabled")

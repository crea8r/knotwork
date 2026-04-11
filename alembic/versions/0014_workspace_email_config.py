"""Add workspace-scoped email configuration.

Revision ID: 0014_workspace_email
Revises: 0013_channel_events
Create Date: 2026-03-25
"""

import sqlalchemy as sa
from alembic import op


revision = "0014_workspace_email"
down_revision = "0013_channel_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("workspaces")}

    if "resend_api_key" not in existing_columns:
        op.add_column("workspaces", sa.Column("resend_api_key", sa.String(), nullable=True))
    if "email_from" not in existing_columns:
        op.add_column("workspaces", sa.Column("email_from", sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("workspaces")}

    if "email_from" in existing_columns:
        op.drop_column("workspaces", "email_from")
    if "resend_api_key" in existing_columns:
        op.drop_column("workspaces", "resend_api_key")

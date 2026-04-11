"""add waitlist signups table

Revision ID: 0024_waitlist
Revises: 0023_folder_scope
Create Date: 2026-04-11
"""

import sqlalchemy as sa
from alembic import op


revision = "0024_waitlist"
down_revision = "0023_folder_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "waitlist_signups",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("team_size", sa.String(length=32), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email", name="uq_waitlist_signups_email"),
    )


def downgrade() -> None:
    op.drop_table("waitlist_signups")

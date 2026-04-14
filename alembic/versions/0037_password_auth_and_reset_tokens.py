"""add password auth flags and reset tokens

Revision ID: 0037_password_auth
Revises: 0036_member_profile_status
Create Date: 2026-04-13
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0037_password_auth"
down_revision = "0036_member_profile_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("must_change_password", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_table(
        "user_password_reset_tokens",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token", sa.String(length=120), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index(
        "ix_user_password_reset_tokens_user_id",
        "user_password_reset_tokens",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_user_password_reset_tokens_user_id", table_name="user_password_reset_tokens")
    op.drop_table("user_password_reset_tokens")
    op.drop_column("users", "must_change_password")

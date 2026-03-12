"""s8_1_user_profile: add bio and avatar_url to users

Revision ID: d0e1f2a3b4c5
Revises: b2c3d4e5f6a7
Create Date: 2026-03-10
"""
from alembic import op
import sqlalchemy as sa

revision = "d0e1f2a3b4c5"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("bio", sa.String(300), nullable=True))
    op.add_column("users", sa.Column("avatar_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
    op.drop_column("users", "bio")

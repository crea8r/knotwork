"""Workspace email settings (stub — already applied to DB in prior session).

Revision ID: 0012_workspace_email
Revises: 0010_graph_paths
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa

revision = '0012_workspace_email'
down_revision = '0010_graph_paths'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Already applied — this stub exists to satisfy the migration chain.
    pass


def downgrade() -> None:
    pass

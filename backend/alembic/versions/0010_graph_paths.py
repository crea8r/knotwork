"""Add path field to graphs for handbook/library placement.

Revision ID: 0010_graph_paths
Revises: 0009_handbook_hardening
Create Date: 2026-03-24
"""

from alembic import op
import sqlalchemy as sa


revision = "0010_graph_paths"
down_revision = "0009_handbook_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("graphs", sa.Column("path", sa.String(), nullable=False, server_default=""))
    op.alter_column("graphs", "path", server_default=None)


def downgrade() -> None:
    op.drop_column("graphs", "path")

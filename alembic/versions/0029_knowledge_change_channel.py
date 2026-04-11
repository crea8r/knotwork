"""knowledge change channels

Revision ID: 0029
Revises: 0028
Create Date: 2026-04-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "run_handbook_proposals",
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_run_handbook_proposals_channel_id",
        "run_handbook_proposals",
        "channels",
        ["channel_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_run_handbook_proposals_channel_id", "run_handbook_proposals", type_="foreignkey")
    op.drop_column("run_handbook_proposals", "channel_id")

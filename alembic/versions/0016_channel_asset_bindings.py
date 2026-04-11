"""s10 channel asset bindings

Revision ID: 0016_channel_asset_bind
Revises: 0015_inbox_state
Create Date: 2026-03-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0016_channel_asset_bind"
down_revision = "0015_inbox_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "channel_asset_bindings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_type", sa.String(length=30), nullable=False),
        sa.Column("asset_id", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("channel_id", "asset_type", "asset_id", name="uq_channel_asset_bindings_channel_asset"),
    )


def downgrade() -> None:
    op.drop_table("channel_asset_bindings")

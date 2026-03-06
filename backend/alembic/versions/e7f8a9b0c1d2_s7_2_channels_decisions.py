"""S7.2 channels + decisions + inbox foundation

Revision ID: e7f8a9b0c1d2
Revises: d9e8f7a6b5c4
Create Date: 2026-03-04 15:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, None] = "d9e8f7a6b5c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "channels",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("channel_type", sa.String(length=20), nullable=False),
        sa.Column("graph_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["graph_id"], ["graphs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_channels_workspace_id", "channels", ["workspace_id"])
    op.create_index("ix_channels_graph_id", "channels", ["graph_id"])

    op.create_table(
        "channel_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("node_id", sa.String(length=200), nullable=True),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("author_type", sa.String(length=20), nullable=False),
        sa.Column("author_name", sa.String(length=200), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_channel_messages_channel_id", "channel_messages", ["channel_id"])
    op.create_index("ix_channel_messages_workspace_id", "channel_messages", ["workspace_id"])

    op.create_table(
        "decision_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("escalation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decision_type", sa.String(length=50), nullable=False),
        sa.Column("actor_type", sa.String(length=20), nullable=False),
        sa.Column("actor_name", sa.String(length=200), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"]),
        sa.ForeignKeyConstraint(["escalation_id"], ["escalations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_decision_events_channel_id", "decision_events", ["channel_id"])
    op.create_index("ix_decision_events_run_id", "decision_events", ["run_id"])
    op.create_index("ix_decision_events_workspace_id", "decision_events", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_decision_events_workspace_id", table_name="decision_events")
    op.drop_index("ix_decision_events_run_id", table_name="decision_events")
    op.drop_index("ix_decision_events_channel_id", table_name="decision_events")
    op.drop_table("decision_events")

    op.drop_index("ix_channel_messages_workspace_id", table_name="channel_messages")
    op.drop_index("ix_channel_messages_channel_id", table_name="channel_messages")
    op.drop_table("channel_messages")

    op.drop_index("ix_channels_graph_id", table_name="channels")
    op.drop_index("ix_channels_workspace_id", table_name="channels")
    op.drop_table("channels")

"""S7.2 OpenAI call logs for debugging

Revision ID: f1a2b3c4d5e6
Revises: e7f8a9b0c1d2
Create Date: 2026-03-05 11:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "openai_call_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_node_state_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("node_id", sa.String(), nullable=False),
        sa.Column("agent_ref", sa.String(), nullable=True),
        sa.Column("provider", sa.String(length=50), nullable=False, server_default="openai"),
        sa.Column("openai_assistant_id", sa.String(length=200), nullable=True),
        sa.Column("openai_thread_id", sa.String(length=200), nullable=True),
        sa.Column("openai_run_id", sa.String(length=200), nullable=True),
        sa.Column("request_payload", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("response_payload", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="started"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.ForeignKeyConstraint(["workflow_id"], ["graphs.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_node_state_id"], ["run_node_states.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_openai_call_logs_run_id", "openai_call_logs", ["run_id"])
    op.create_index("ix_openai_call_logs_workspace_id", "openai_call_logs", ["workspace_id"])
    op.create_index("ix_openai_call_logs_openai_run_id", "openai_call_logs", ["openai_run_id"])


def downgrade() -> None:
    op.drop_index("ix_openai_call_logs_openai_run_id", table_name="openai_call_logs")
    op.drop_index("ix_openai_call_logs_workspace_id", table_name="openai_call_logs")
    op.drop_index("ix_openai_call_logs_run_id", table_name="openai_call_logs")
    op.drop_table("openai_call_logs")

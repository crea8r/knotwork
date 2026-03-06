"""s8_openclaw_execution_bridge

Revision ID: e3f4a5b6c7d8
Revises: d1e2f3a4b5c6
Create Date: 2026-03-05 20:05:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e3f4a5b6c7d8"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("openclaw_integrations", sa.Column("integration_secret", sa.String(length=120), nullable=True))
    op.execute("UPDATE openclaw_integrations SET integration_secret = md5(random()::text || clock_timestamp()::text)")
    op.alter_column("openclaw_integrations", "integration_secret", nullable=False)

    op.add_column("registered_agents", sa.Column("openclaw_integration_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("registered_agents", sa.Column("openclaw_remote_agent_id", sa.String(length=200), nullable=True))

    op.create_table(
        "openclaw_execution_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("integration_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("node_id", sa.String(length=120), nullable=False),
        sa.Column("agent_ref", sa.String(length=200), nullable=False),
        sa.Column("remote_agent_id", sa.String(length=200), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("user_prompt", sa.Text(), nullable=False),
        sa.Column("session_token", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("output_text", sa.Text(), nullable=True),
        sa.Column("next_branch", sa.String(length=120), nullable=True),
        sa.Column("escalation_question", sa.Text(), nullable=True),
        sa.Column("escalation_options_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["integration_id"], ["openclaw_integrations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_openclaw_execution_tasks_pick", "openclaw_execution_tasks", ["integration_id", "status", "created_at"])
    op.create_index("ix_openclaw_execution_tasks_run_node", "openclaw_execution_tasks", ["run_id", "node_id", "created_at"])

    op.create_table(
        "openclaw_execution_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["openclaw_execution_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_openclaw_execution_events_task", "openclaw_execution_events", ["task_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_openclaw_execution_events_task", table_name="openclaw_execution_events")
    op.drop_table("openclaw_execution_events")

    op.drop_index("ix_openclaw_execution_tasks_run_node", table_name="openclaw_execution_tasks")
    op.drop_index("ix_openclaw_execution_tasks_pick", table_name="openclaw_execution_tasks")
    op.drop_table("openclaw_execution_tasks")

    op.drop_column("registered_agents", "openclaw_remote_agent_id")
    op.drop_column("registered_agents", "openclaw_integration_id")

    op.drop_column("openclaw_integrations", "integration_secret")

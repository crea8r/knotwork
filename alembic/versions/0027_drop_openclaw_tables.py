"""Drop OpenClaw plugin tables (superseded by S12.1 unified participant model).

The four tables below implemented the old pull-task execution bridge:
  - openclaw_execution_events
  - openclaw_execution_tasks
  - openclaw_integrations
  - openclaw_handshake_tokens

They are replaced by the ed25519 JWT auth + inbox polling model from S12.1.
Also strips openclaw_integration_id / openclaw_remote_agent_id from
workspace_members.agent_config (left by migration 0024).

Revision ID: 0027_drop_openclaw_tables
Revises: 0026_agent_auth_challenges
Create Date: 2026-04-02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "0027_drop_openclaw_tables"
down_revision = "0026_agent_auth_challenges"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop in FK-safe order: events → tasks → integrations → handshake_tokens
    op.drop_table("openclaw_execution_events")
    op.drop_table("openclaw_execution_tasks")
    op.drop_table("openclaw_integrations")
    op.drop_table("openclaw_handshake_tokens")

    # Strip openclaw-specific keys from workspace_members.agent_config JSON.
    # agent_config is stored as json (not jsonb), so cast to jsonb for key deletion,
    # then back to json for storage.
    op.execute(
        """
        UPDATE workspace_members
        SET agent_config = (
            agent_config::jsonb
            - 'openclaw_integration_id'
            - 'openclaw_remote_agent_id'
        )::json
        WHERE agent_config IS NOT NULL
          AND kind = 'agent'
        """
    )


def downgrade() -> None:
    # Recreate tables in reverse FK-safe order.
    # agent_config keys are NOT restored — the integration data is gone.
    op.create_table(
        "openclaw_handshake_tokens",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String, nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "openclaw_integrations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=True), nullable=False),
        sa.Column("plugin_instance_id", sa.String, nullable=False),
        sa.Column("openclaw_workspace_id", sa.String, nullable=True),
        sa.Column("plugin_version", sa.String, nullable=True),
        sa.Column("integration_secret", sa.String, nullable=False),
        sa.Column("status", sa.String, nullable=False, server_default="connected"),
        sa.Column("connected_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("tasks_running", sa.Integer, nullable=True),
        sa.Column("slots_available", sa.Integer, nullable=True),
        sa.Column("metadata_json", JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("workspace_id", "plugin_instance_id", name="uq_openclaw_integrations_workspace_plugin"),
    )
    op.create_table(
        "openclaw_execution_tasks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=True), nullable=False),
        sa.Column("integration_id", UUID(as_uuid=True), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=True),
        sa.Column("node_id", sa.String, nullable=False),
        sa.Column("agent_ref", sa.String, nullable=False),
        sa.Column("remote_agent_id", sa.String, nullable=False),
        sa.Column("system_prompt", sa.Text, nullable=False),
        sa.Column("user_prompt", sa.Text, nullable=False),
        sa.Column("session_token", sa.String, nullable=False),
        sa.Column("status", sa.String, nullable=False, server_default="pending"),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("output_text", sa.Text, nullable=True),
        sa.Column("next_branch", sa.String, nullable=True),
        sa.Column("escalation_question", sa.Text, nullable=True),
        sa.Column("escalation_questions_json", JSONB, nullable=False, server_default="[]"),
        sa.Column("escalation_options_json", JSONB, nullable=False, server_default="[]"),
        sa.Column("attachments_json", JSONB, nullable=False, server_default="[]"),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "openclaw_execution_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String, nullable=False),
        sa.Column("payload_json", JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

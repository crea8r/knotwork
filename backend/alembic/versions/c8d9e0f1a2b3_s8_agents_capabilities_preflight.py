"""s8_agents_capabilities_preflight

Revision ID: c8d9e0f1a2b3
Revises: f1a2b3c4d5e6
Create Date: 2026-03-05 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c8d9e0f1a2b3"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("registered_agents", sa.Column("status", sa.String(length=50), nullable=False, server_default=sa.text("'inactive'")))
    op.add_column("registered_agents", sa.Column("credential_type", sa.String(length=50), nullable=True))
    op.add_column("registered_agents", sa.Column("credential_ciphertext", sa.Text(), nullable=True))
    op.add_column("registered_agents", sa.Column("credential_hint", sa.String(length=100), nullable=True))
    op.add_column("registered_agents", sa.Column("capability_version", sa.String(length=120), nullable=True))
    op.add_column("registered_agents", sa.Column("capability_hash", sa.String(length=120), nullable=True))
    op.add_column("registered_agents", sa.Column("capability_refreshed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("registered_agents", sa.Column("capability_freshness", sa.String(length=30), nullable=False, server_default=sa.text("'needs_refresh'")))
    op.add_column("registered_agents", sa.Column("preflight_status", sa.String(length=30), nullable=False, server_default=sa.text("'never_run'")))
    op.add_column("registered_agents", sa.Column("preflight_run_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("registered_agents", sa.Column("baseline_preflight_run_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("registered_agents", sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("registered_agents", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("registered_agents", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")))

    op.execute("UPDATE registered_agents SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END")
    op.execute("UPDATE registered_agents SET capability_freshness = 'needs_refresh' WHERE capability_freshness IS NULL")
    op.execute("UPDATE registered_agents SET preflight_status = 'never_run' WHERE preflight_status IS NULL")

    op.create_index("ix_registered_agents_workspace_status", "registered_agents", ["workspace_id", "status"])
    op.create_index("ix_registered_agents_workspace_provider", "registered_agents", ["workspace_id", "provider"])

    op.create_table(
        "agent_capability_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.String(length=120), nullable=True),
        sa.Column("hash", sa.String(length=120), nullable=False),
        sa.Column("source", sa.String(length=30), nullable=False, server_default=sa.text("'refresh'")),
        sa.Column("tools_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("constraints_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("policy_notes_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("raw_contract_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("changed_from_previous", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["registered_agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_capability_snapshots_agent_created", "agent_capability_snapshots", ["agent_id", "created_at"])
    op.create_index("ux_agent_capability_snapshots_agent_hash", "agent_capability_snapshots", ["agent_id", "hash"], unique=True)

    op.create_table(
        "agent_preflight_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("suite_name", sa.String(length=80), nullable=False, server_default=sa.text("'default'")),
        sa.Column("include_optional", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("required_total", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("required_passed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("optional_total", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("optional_passed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("pass_rate", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("median_latency_ms", sa.Integer(), nullable=True),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_baseline", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["registered_agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_preflight_runs_agent_created", "agent_preflight_runs", ["agent_id", "created_at"])
    op.create_index(
        "ux_agent_preflight_runs_baseline",
        "agent_preflight_runs",
        ["agent_id"],
        unique=True,
        postgresql_where=sa.text("is_baseline = true"),
    )

    op.create_table(
        "agent_preflight_tests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("preflight_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("agent_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("test_id", sa.String(length=120), nullable=False),
        sa.Column("tool_name", sa.String(length=120), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("request_preview_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("response_preview_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["preflight_run_id"], ["agent_preflight_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["registered_agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_preflight_tests_run", "agent_preflight_tests", ["preflight_run_id"])
    op.create_index("ux_agent_preflight_tests_unique", "agent_preflight_tests", ["preflight_run_id", "test_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ux_agent_preflight_tests_unique", table_name="agent_preflight_tests")
    op.drop_index("ix_agent_preflight_tests_run", table_name="agent_preflight_tests")
    op.drop_table("agent_preflight_tests")

    op.drop_index("ux_agent_preflight_runs_baseline", table_name="agent_preflight_runs")
    op.drop_index("ix_agent_preflight_runs_agent_created", table_name="agent_preflight_runs")
    op.drop_table("agent_preflight_runs")

    op.drop_index("ux_agent_capability_snapshots_agent_hash", table_name="agent_capability_snapshots")
    op.drop_index("ix_agent_capability_snapshots_agent_created", table_name="agent_capability_snapshots")
    op.drop_table("agent_capability_snapshots")

    op.drop_index("ix_registered_agents_workspace_provider", table_name="registered_agents")
    op.drop_index("ix_registered_agents_workspace_status", table_name="registered_agents")

    op.drop_column("registered_agents", "updated_at")
    op.drop_column("registered_agents", "archived_at")
    op.drop_column("registered_agents", "last_used_at")
    op.drop_column("registered_agents", "baseline_preflight_run_id")
    op.drop_column("registered_agents", "preflight_run_at")
    op.drop_column("registered_agents", "preflight_status")
    op.drop_column("registered_agents", "capability_freshness")
    op.drop_column("registered_agents", "capability_refreshed_at")
    op.drop_column("registered_agents", "capability_hash")
    op.drop_column("registered_agents", "capability_version")
    op.drop_column("registered_agents", "credential_hint")
    op.drop_column("registered_agents", "credential_ciphertext")
    op.drop_column("registered_agents", "credential_type")
    op.drop_column("registered_agents", "status")

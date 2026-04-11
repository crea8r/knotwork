"""Unified participant model: merge RegisteredAgent into WorkspaceMember.

Each RegisteredAgent becomes a User row (no email, no password) +
a WorkspaceMember row (kind='agent', agent_config carries provider metadata).

Participant IDs in graph definitions, escalations, and channel subscriptions
are remapped from agent:{registered_agent.id} → agent:{new_workspace_member.id}.

Tables dropped in this migration (data migrated or superseded):
  - agent_capability_snapshots  (→ employee-bridge/spec)
  - agent_preflight_tests       (→ employee-bridge/spec)
  - agent_preflight_runs        (→ employee-bridge/spec)
  - openclaw_remote_agents      (remote_agent_id moves to WorkspaceMember.agent_config)

Tables NOT dropped yet (Phase 3, after service code is updated):
  - registered_agents

Revision ID: 0024_unified_participant
Revises: 0023_folder_scope
Create Date: 2026-04-01
"""
from __future__ import annotations

import json
import uuid as _uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0024_unified_participant"
down_revision = "0023_folder_scope"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _new_id() -> str:
    return str(_uuid.uuid4())


def _remap_participant_id(pid: str, agent_id_map: dict[str, str]) -> str:
    """Replace agent:{old_agent_id} → agent:{new_member_id}."""
    if pid.startswith("agent:"):
        old = pid[len("agent:"):]
        if old in agent_id_map:
            return f"agent:{agent_id_map[old]}"
    return pid


def _remap_definition(definition: dict, agent_id_map: dict[str, str]) -> dict:
    """Remap registered_agent_id and supervisor_id inside a graph definition."""
    nodes = definition.get("nodes", [])
    changed = False
    for node in nodes:
        config = node.get("config") or {}

        # registered_agent_id: UUID string pointing to old RegisteredAgent
        old_ra_id = str(config.get("registered_agent_id") or "")
        if old_ra_id and old_ra_id in agent_id_map:
            config["registered_agent_id"] = agent_id_map[old_ra_id]
            node["config"] = config
            changed = True

        # supervisor_id: participant_id string "agent:{uuid}"
        sup = node.get("supervisor_id") or config.get("supervisor_id") or ""
        new_sup = _remap_participant_id(str(sup), agent_id_map) if sup else sup
        if new_sup != sup:
            # supervisor_id can live at node level or inside config
            if "supervisor_id" in node:
                node["supervisor_id"] = new_sup
            if "supervisor_id" in config:
                config["supervisor_id"] = new_sup
                node["config"] = config
            changed = True

    return definition if changed else definition


# ---------------------------------------------------------------------------
# upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    conn = op.get_bind()

    # ------------------------------------------------------------------
    # 1. Schema additions
    # ------------------------------------------------------------------

    # users: make email nullable, add public_key
    op.alter_column("users", "email", nullable=True, existing_type=sa.String())
    op.add_column("users", sa.Column("public_key", sa.String(100), nullable=True))

    # workspace_members: add kind + agent_config
    op.add_column(
        "workspace_members",
        sa.Column(
            "kind",
            sa.String(20),
            nullable=False,
            server_default=sa.text("'human'"),
        ),
    )
    op.add_column(
        "workspace_members",
        sa.Column("agent_config", sa.JSON, nullable=True),
    )

    # ------------------------------------------------------------------
    # 2. Data migration: RegisteredAgent → User + WorkspaceMember
    # ------------------------------------------------------------------

    # Check if registered_agents table exists (may not on clean installs)
    inspector = sa.inspect(conn)
    if "registered_agents" not in inspector.get_table_names():
        _drop_legacy_tables(inspector)
        return

    agents = conn.execute(
        sa.text(
            "SELECT id, workspace_id, display_name, avatar_url, provider, agent_ref,"
            " api_key, status, bio, openclaw_integration_id, openclaw_remote_agent_id"
            " FROM registered_agents"
        )
    ).fetchall()

    # Map: str(old_agent_id) → str(new_member_id)
    agent_id_map: dict[str, str] = {}

    for agent in agents:
        old_agent_id = str(agent.id)
        new_user_id = _new_id()
        new_member_id = _new_id()
        agent_id_map[old_agent_id] = new_member_id

        # Build agent_config from RegisteredAgent metadata
        agent_config: dict = {
            "provider": agent.provider,
            "agent_ref": agent.agent_ref,
            "legacy_registered_agent_id": old_agent_id,
        }
        if agent.openclaw_integration_id:
            agent_config["openclaw_integration_id"] = str(agent.openclaw_integration_id)
        if agent.openclaw_remote_agent_id:
            agent_config["openclaw_remote_agent_id"] = agent.openclaw_remote_agent_id
        if agent.api_key:
            agent_config["api_key_hint"] = agent.api_key[:4] + "..." if len(agent.api_key) > 4 else "***"

        # Create User (no email, no password, no public_key yet)
        conn.execute(
            sa.text(
                "INSERT INTO users (id, email, name, hashed_password, public_key,"
                " bio, avatar_url, created_at)"
                " VALUES (:id, NULL, :name, '!no-password', NULL,"
                " :bio, :avatar_url, now())"
            ),
            {
                "id": new_user_id,
                "name": agent.display_name,
                "bio": agent.bio,
                "avatar_url": agent.avatar_url,
            },
        )

        # Create WorkspaceMember (kind='agent')
        # Note: agent_config is passed as a plain text param then cast to jsonb.
        # asyncpg cannot handle :param::jsonb syntax, so we use cast() explicitly.
        conn.execute(
            sa.text(
                "INSERT INTO workspace_members"
                " (id, workspace_id, user_id, role, kind, agent_config, created_at)"
                " VALUES (:id, :workspace_id, :user_id, 'operator', 'agent',"
                " cast(:agent_config as jsonb), now())"
            ),
            {
                "id": new_member_id,
                "workspace_id": str(agent.workspace_id),
                "user_id": new_user_id,
                "agent_config": json.dumps(agent_config),
            },
        )

    # ------------------------------------------------------------------
    # 3. Remap participant IDs in graph definitions
    # ------------------------------------------------------------------

    if agent_id_map:
        versions = conn.execute(
            sa.text("SELECT id, definition FROM graph_versions WHERE definition IS NOT NULL")
        ).fetchall()

        for version in versions:
            defn = version.definition
            if isinstance(defn, str):
                defn = json.loads(defn)

            updated = _remap_definition(defn, agent_id_map)

            conn.execute(
                sa.text(
                    "UPDATE graph_versions SET definition = cast(:defn as jsonb) WHERE id = :id"
                ),
                {"defn": json.dumps(updated), "id": str(version.id)},
            )

        # ------------------------------------------------------------------
        # 4. Remap escalations.assigned_to (list of participant_ids)
        # ------------------------------------------------------------------

        escalations = conn.execute(
            sa.text("SELECT id, assigned_to FROM escalations WHERE assigned_to IS NOT NULL")
        ).fetchall()

        for esc in escalations:
            assigned = esc.assigned_to
            if isinstance(assigned, str):
                assigned = json.loads(assigned)
            if not isinstance(assigned, list):
                continue
            remapped = [_remap_participant_id(pid, agent_id_map) for pid in assigned]
            if remapped != assigned:
                conn.execute(
                    sa.text(
                        "UPDATE escalations SET assigned_to = cast(:v as jsonb) WHERE id = :id"
                    ),
                    {"v": json.dumps(remapped), "id": str(esc.id)},
                )

        # ------------------------------------------------------------------
        # 5. Remap channel_subscriptions.participant_id
        # ------------------------------------------------------------------

        subs = conn.execute(
            sa.text(
                "SELECT id, participant_id FROM channel_subscriptions"
                " WHERE participant_id LIKE 'agent:%'"
            )
        ).fetchall()

        for sub in subs:
            remapped = _remap_participant_id(sub.participant_id, agent_id_map)
            if remapped != sub.participant_id:
                conn.execute(
                    sa.text(
                        "UPDATE channel_subscriptions SET participant_id = :pid WHERE id = :id"
                    ),
                    {"pid": remapped, "id": str(sub.id)},
                )

    # ------------------------------------------------------------------
    # 6. Drop superseded tables (NOT registered_agents — that's Phase 3)
    # ------------------------------------------------------------------

    _drop_legacy_tables(inspector)


def _drop_legacy_tables(inspector: sa.engine.Inspector) -> None:
    existing = inspector.get_table_names()

    # Drop in FK-safe order
    for table in (
        "agent_preflight_tests",
        "agent_preflight_runs",
        "agent_capability_snapshots",
        "openclaw_remote_agents",
    ):
        if table in existing:
            op.drop_table(table)


# ---------------------------------------------------------------------------
# downgrade (best-effort, data loss on registered_agents is accepted)
# ---------------------------------------------------------------------------

def downgrade() -> None:
    op.drop_column("workspace_members", "agent_config")
    op.drop_column("workspace_members", "kind")
    op.drop_column("users", "public_key")
    op.alter_column("users", "email", nullable=False, existing_type=sa.String())

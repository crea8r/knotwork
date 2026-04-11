"""Drop registered_agents table — Phase 3 completion.

All RegisteredAgent rows were migrated to User + WorkspaceMember in 0024.
The Python module (knotwork/registered_agents/) is deleted in the same commit.

Revision ID: 0025_drop_registered_agents
Revises: 0024_unified_participant
Create Date: 2026-04-01
"""
from alembic import op

revision = "0025_drop_registered_agents"
down_revision = "0024_unified_participant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    import sqlalchemy as sa

    inspector = sa.inspect(op.get_bind())
    if "registered_agents" in inspector.get_table_names():
        op.drop_table("registered_agents")


def downgrade() -> None:
    # Intentional no-op: data was migrated to workspace_members in 0024.
    # Recreating the empty table schema is possible but restoring data is not.
    pass

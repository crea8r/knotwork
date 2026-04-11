"""Add agent_auth_challenges table for ed25519 challenge-response auth.

Revision ID: 0026_agent_auth_challenges
Revises: 0025_drop_registered_agents
Create Date: 2026-04-01
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0026_agent_auth_challenges"
down_revision = "0025_drop_registered_agents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_auth_challenges",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("public_key", sa.String(100), nullable=False),
        sa.Column("nonce", sa.String(120), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_agent_auth_challenges_public_key", "agent_auth_challenges", ["public_key"])


def downgrade() -> None:
    op.drop_index("ix_agent_auth_challenges_public_key", table_name="agent_auth_challenges")
    op.drop_table("agent_auth_challenges")

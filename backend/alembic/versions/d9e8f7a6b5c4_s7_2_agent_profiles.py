"""S7.2 agent profiles

Revision ID: d9e8f7a6b5c4
Revises: a1b2c3d4e5f6
Create Date: 2026-03-04 10:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d9e8f7a6b5c4"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "registered_agents",
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registered_agents", "avatar_url")

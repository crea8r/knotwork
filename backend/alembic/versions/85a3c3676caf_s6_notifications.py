"""s6_notifications

Revision ID: 85a3c3676caf
Revises: 370b42968dd8
Create Date: 2026-03-01 11:15:28.436479

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '85a3c3676caf'
down_revision: Union[str, None] = '370b42968dd8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('notification_preferences',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('email_enabled', sa.Boolean(), nullable=False, server_default='false'),
    sa.Column('email_address', sa.String(), nullable=True),
    sa.Column('telegram_enabled', sa.Boolean(), nullable=False, server_default='false'),
    sa.Column('telegram_chat_id', sa.String(), nullable=True),
    sa.Column('whatsapp_enabled', sa.Boolean(), nullable=False, server_default='false'),
    sa.Column('whatsapp_number', sa.String(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('workspace_id')
    )
    op.create_table('notification_logs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=False),
    sa.Column('escalation_id', sa.UUID(), nullable=True),
    sa.Column('channel', sa.String(), nullable=False),
    sa.Column('status', sa.String(), nullable=False, server_default='sent'),
    sa.Column('detail', sa.Text(), nullable=True),
    sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['escalation_id'], ['escalations.id'], ),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('notification_logs')
    op.drop_table('notification_preferences')

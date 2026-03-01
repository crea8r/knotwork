"""s6_tools_notifications

Revision ID: 370b42968dd8
Revises: 36b0d7001ff8
Create Date: 2026-02-28 16:06:03.334488

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '370b42968dd8'
down_revision: Union[str, None] = '36b0d7001ff8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('tools',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('workspace_id', sa.UUID(), nullable=True),
    sa.Column('graph_id', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('slug', sa.String(), nullable=False),
    sa.Column('category', sa.String(), nullable=False),
    sa.Column('scope', sa.String(), nullable=False, server_default='workspace'),
    sa.Column('definition', sa.JSON(), nullable=False, server_default='{}'),
    sa.Column('current_version', sa.String(), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['graph_id'], ['graphs.id'], ),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('tool_versions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tool_id', sa.UUID(), nullable=False),
    sa.Column('definition', sa.JSON(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['tool_id'], ['tools.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
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
    op.drop_table('tool_versions')
    op.drop_table('tools')

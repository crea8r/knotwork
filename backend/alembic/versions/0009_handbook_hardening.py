"""Handbook UI hardening — folders + binary file support.

Adds:
- knowledge_folders: explicit empty-folder support (Windows-Explorer UX)
- knowledge_files.file_type: 'md' | 'pdf' | 'docx' | 'image' | 'other'
- knowledge_files.is_editable: False for binary files stored as view-only

Revision ID: 0009_handbook_hardening
Revises: 0008_version_management
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0009_handbook_hardening'
down_revision = '0008_version_management'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'knowledge_folders',
        sa.Column('id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('workspace_id', UUID(as_uuid=True),
                  sa.ForeignKey('workspaces.id', ondelete='CASCADE'), nullable=False),
        sa.Column('path', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('workspace_id', 'path', name='uq_knowledge_folders_ws_path'),
    )
    op.create_index('ix_knowledge_folders_workspace', 'knowledge_folders', ['workspace_id'])

    op.add_column('knowledge_files',
        sa.Column('file_type', sa.String(), nullable=False, server_default='md'))
    op.add_column('knowledge_files',
        sa.Column('is_editable', sa.Boolean(), nullable=False, server_default='true'))


def downgrade() -> None:
    op.drop_column('knowledge_files', 'is_editable')
    op.drop_column('knowledge_files', 'file_type')
    op.drop_index('ix_knowledge_folders_workspace', table_name='knowledge_folders')
    op.drop_table('knowledge_folders')

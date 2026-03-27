"""Add version_slug to public_workflow_links.

Revision ID: 0011_public_link_slugs
Revises: 0010_graph_paths
Create Date: 2026-03-25
"""
from alembic import op
import sqlalchemy as sa

revision = '0011_public_link_slugs'
down_revision = '0010_graph_paths'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE public_workflow_links ADD COLUMN IF NOT EXISTS version_slug VARCHAR(200)")
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_pwl_version_slug'
            ) THEN
                ALTER TABLE public_workflow_links ADD CONSTRAINT uq_pwl_version_slug UNIQUE (version_slug);
            END IF;
        END $$
    """)


def downgrade() -> None:
    op.drop_constraint('uq_pwl_version_slug', 'public_workflow_links', type_='unique')
    op.drop_column('public_workflow_links', 'version_slug')

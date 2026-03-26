"""Move public link state onto GraphVersion; drop PublicWorkflowLink table.

Revision ID: 0013_version_public_slugs
Revises: 0011_public_link_slugs
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa

revision = '0013_version_public_slugs'
down_revision = '0011_public_link_slugs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add public fields to graph_versions
    op.execute("ALTER TABLE graph_versions ADD COLUMN IF NOT EXISTS version_slug VARCHAR(200)")
    op.execute("ALTER TABLE graph_versions ADD COLUMN IF NOT EXISTS public_description_md TEXT")
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_graph_versions_version_slug'
            ) THEN
                ALTER TABLE graph_versions ADD CONSTRAINT uq_graph_versions_version_slug UNIQUE (version_slug);
            END IF;
        END $$
    """)
    # Drop is_public column if it exists
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'graph_versions' AND column_name = 'is_public'
            ) THEN
                ALTER TABLE graph_versions DROP COLUMN is_public;
            END IF;
        END $$
    """)

    # Update public_run_shares: replace public_workflow_id with graph_version_id
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'public_run_shares' AND column_name = 'public_workflow_id'
            ) THEN
                ALTER TABLE public_run_shares DROP COLUMN public_workflow_id;
            END IF;
        END $$
    """)
    op.execute("ALTER TABLE public_run_shares ADD COLUMN IF NOT EXISTS graph_version_id UUID REFERENCES graph_versions(id) ON DELETE CASCADE")

    # Drop public_workflow_links table (test data only — no migration of rows)
    op.execute("DROP TABLE IF EXISTS public_workflow_links CASCADE")


def downgrade() -> None:
    # Restore public_workflow_links (empty)
    op.execute("""
        CREATE TABLE IF NOT EXISTS public_workflow_links (
            id UUID PRIMARY KEY,
            workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            graph_id UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
            graph_version_id UUID REFERENCES graph_versions(id) ON DELETE SET NULL,
            token VARCHAR(120) NOT NULL UNIQUE,
            version_slug VARCHAR(200) UNIQUE,
            description_md TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            created_by UUID REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("ALTER TABLE public_run_shares DROP COLUMN IF EXISTS graph_version_id")
    op.execute("ALTER TABLE public_run_shares ADD COLUMN IF NOT EXISTS public_workflow_id UUID REFERENCES public_workflow_links(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE graph_versions DROP COLUMN IF EXISTS version_slug")
    op.execute("ALTER TABLE graph_versions DROP COLUMN IF EXISTS public_description_md")
    op.execute("ALTER TABLE graph_versions ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE")

"""S9.1 workflow version management

Adds draft/version distinction to graph_versions, production pointer on graphs,
and draft snapshot fields on runs.

Revision ID: 0008_version_management
Revises: 0007_integration_capacity
Create Date: 2026-03-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0008_version_management'
down_revision = '0007_integration_capacity'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- graph_versions: new versioning columns ---
    op.add_column('graph_versions', sa.Column('version_id', sa.String(9), nullable=True))
    op.add_column('graph_versions', sa.Column('version_name', sa.String(200), nullable=True))
    op.add_column('graph_versions', sa.Column('version_created_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('graph_versions', sa.Column(
        'parent_version_id', UUID(as_uuid=True),
        sa.ForeignKey('graph_versions.id'), nullable=True
    ))
    op.add_column('graph_versions', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('graph_versions', sa.Column('is_public', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('graph_versions', sa.Column(
        'updated_at', sa.DateTime(timezone=True),
        server_default=sa.text('now()'), nullable=False
    ))

    # Unique constraint: (graph_id, version_id) — partial uniqueness for non-null version_ids
    # (NULL values are not equal in SQL, so the unique constraint naturally allows multiple NULLs)
    op.create_unique_constraint(
        'uq_graph_versions_graph_version', 'graph_versions', ['graph_id', 'version_id']
    )

    # Migrate existing records: all current GraphVersion rows become versions (not drafts)
    # Assign sequential version_ids and coolname-style names
    op.execute("""
        UPDATE graph_versions
        SET
            version_id = substr(md5(random()::text || id::text), 1, 9),
            version_name = 'initial-version-1',
            version_created_at = created_at
        WHERE version_id IS NULL
    """)

    # --- graphs: production pointer + slug ---
    op.add_column('graphs', sa.Column(
        'production_version_id', UUID(as_uuid=True), nullable=True
    ))
    op.add_column('graphs', sa.Column('slug', sa.String(200), nullable=True))
    op.create_unique_constraint('uq_graphs_slug', 'graphs', ['slug'])
    op.create_foreign_key(
        'fk_graphs_production_version',
        'graphs', 'graph_versions',
        ['production_version_id'], ['id'],
        use_alter=True,
    )

    # Point each graph's production_version_id at its most recently created version
    op.execute("""
        UPDATE graphs g
        SET production_version_id = (
            SELECT id FROM graph_versions gv
            WHERE gv.graph_id = g.id
            ORDER BY gv.created_at DESC
            LIMIT 1
        )
        WHERE EXISTS (SELECT 1 FROM graph_versions gv2 WHERE gv2.graph_id = g.id)
    """)

    # --- runs: make graph_version_id nullable, add draft snapshot fields ---
    op.alter_column('runs', 'graph_version_id', nullable=True)
    op.add_column('runs', sa.Column('draft_definition', sa.JSON(), nullable=True))
    op.add_column('runs', sa.Column('draft_snapshot_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # runs
    op.drop_column('runs', 'draft_snapshot_at')
    op.drop_column('runs', 'draft_definition')
    op.alter_column('runs', 'graph_version_id', nullable=False)

    # graphs
    op.drop_constraint('fk_graphs_production_version', 'graphs', type_='foreignkey')
    op.drop_constraint('uq_graphs_slug', 'graphs', type_='unique')
    op.drop_column('graphs', 'slug')
    op.drop_column('graphs', 'production_version_id')

    # graph_versions
    op.drop_constraint('uq_graph_versions_graph_version', 'graph_versions', type_='unique')
    op.drop_column('graph_versions', 'updated_at')
    op.drop_column('graph_versions', 'is_public')
    op.drop_column('graph_versions', 'archived_at')
    op.drop_column('graph_versions', 'parent_version_id')
    op.drop_column('graph_versions', 'version_created_at')
    op.drop_column('graph_versions', 'version_name')
    op.drop_column('graph_versions', 'version_id')

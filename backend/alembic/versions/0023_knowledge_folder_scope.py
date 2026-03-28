"""scope knowledge folder uniqueness by project

Revision ID: 0023_folder_scope
Revises: 0022_entity_slugs
Create Date: 2026-03-29
"""

import sqlalchemy as sa
from alembic import op


revision = "0023_folder_scope"
down_revision = "0022_entity_slugs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("uq_knowledge_folders_ws_path", "knowledge_folders", type_="unique")
    op.create_index(
        "uq_knowledge_folders_global_path",
        "knowledge_folders",
        ["workspace_id", "path"],
        unique=True,
        postgresql_where=sa.text("project_id IS NULL"),
    )
    op.create_index(
        "uq_knowledge_folders_project_path",
        "knowledge_folders",
        ["workspace_id", "project_id", "path"],
        unique=True,
        postgresql_where=sa.text("project_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_knowledge_folders_project_path", table_name="knowledge_folders")
    op.drop_index("uq_knowledge_folders_global_path", table_name="knowledge_folders")
    op.create_unique_constraint(
        "uq_knowledge_folders_ws_path",
        "knowledge_folders",
        ["workspace_id", "path"],
    )

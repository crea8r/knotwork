"""Rename project objective to description and clean objective constraint names.

Revision ID: 0020_project_desc_cleanup
Revises: 0019_rename_tasks_to_objectives
Create Date: 2026-03-27
"""

from alembic import op


revision = "0020_project_desc_cleanup"
down_revision = "0019_rename_tasks_to_objectives"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.alter_column("objective", new_column_name="description")

    op.execute("ALTER TABLE objectives RENAME CONSTRAINT tasks_pkey TO objectives_pkey")
    op.execute("ALTER TABLE objectives RENAME CONSTRAINT fk_tasks_parent_task_id TO fk_objectives_parent_objective_id")
    op.execute("ALTER TABLE runs RENAME CONSTRAINT fk_runs_task_id TO fk_runs_objective_id")
    op.execute("ALTER TABLE channels RENAME CONSTRAINT fk_channels_task_id TO fk_channels_objective_id")


def downgrade() -> None:
    op.execute("ALTER TABLE channels RENAME CONSTRAINT fk_channels_objective_id TO fk_channels_task_id")
    op.execute("ALTER TABLE runs RENAME CONSTRAINT fk_runs_objective_id TO fk_runs_task_id")
    op.execute("ALTER TABLE objectives RENAME CONSTRAINT fk_objectives_parent_objective_id TO fk_tasks_parent_task_id")
    op.execute("ALTER TABLE objectives RENAME CONSTRAINT objectives_pkey TO tasks_pkey")

    with op.batch_alter_table("projects") as batch_op:
        batch_op.alter_column("description", new_column_name="objective")

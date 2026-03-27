"""Rename tasks substrate to objectives.

Revision ID: 0019_rename_tasks_to_objectives
Revises: 0018_objective_fields
Create Date: 2026-03-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0019_rename_tasks_to_objectives"
down_revision = "0018_objective_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("tasks", "objectives")
    op.execute("ALTER INDEX ix_tasks_workspace_id RENAME TO ix_objectives_workspace_id")
    op.execute("ALTER INDEX ix_tasks_project_id RENAME TO ix_objectives_project_id")
    op.execute("ALTER INDEX ix_tasks_parent_task_id RENAME TO ix_objectives_parent_objective_id")

    with op.batch_alter_table("objectives") as batch_op:
        batch_op.alter_column("parent_task_id", new_column_name="parent_objective_id")

    with op.batch_alter_table("runs") as batch_op:
        batch_op.alter_column("task_id", new_column_name="objective_id")

    with op.batch_alter_table("channels") as batch_op:
        batch_op.alter_column("task_id", new_column_name="objective_id")

    op.execute("ALTER INDEX ix_runs_task_id RENAME TO ix_runs_objective_id")
    op.execute("ALTER INDEX ix_channels_task_id RENAME TO ix_channels_objective_id")
    op.execute("UPDATE channels SET channel_type = 'objective' WHERE channel_type = 'task'")


def downgrade() -> None:
    op.execute("UPDATE channels SET channel_type = 'task' WHERE channel_type = 'objective'")
    op.execute("ALTER INDEX ix_channels_objective_id RENAME TO ix_channels_task_id")
    op.execute("ALTER INDEX ix_runs_objective_id RENAME TO ix_runs_task_id")

    with op.batch_alter_table("channels") as batch_op:
        batch_op.alter_column("objective_id", new_column_name="task_id")

    with op.batch_alter_table("runs") as batch_op:
        batch_op.alter_column("objective_id", new_column_name="task_id")

    with op.batch_alter_table("objectives") as batch_op:
        batch_op.alter_column("parent_objective_id", new_column_name="parent_task_id")

    op.execute("ALTER INDEX ix_objectives_parent_objective_id RENAME TO ix_tasks_parent_task_id")
    op.execute("ALTER INDEX ix_objectives_project_id RENAME TO ix_tasks_project_id")
    op.execute("ALTER INDEX ix_objectives_workspace_id RENAME TO ix_tasks_workspace_id")
    op.rename_table("objectives", "tasks")

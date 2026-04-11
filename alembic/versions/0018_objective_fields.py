"""Add objective fields onto tasks.

Revision ID: 0018_objective_fields
Revises: 0017_projects_tasks
Create Date: 2026-03-25
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0018_objective_fields"
down_revision = "0017_projects_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("parent_task_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("tasks", sa.Column("code", sa.String(length=20), nullable=True))
    op.add_column("tasks", sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("tasks", sa.Column("status_summary", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("key_results", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")))
    op.add_column("tasks", sa.Column("owner_type", sa.String(length=20), nullable=True))
    op.add_column("tasks", sa.Column("owner_name", sa.String(length=200), nullable=True))
    op.add_column("tasks", sa.Column("deadline", sa.Date(), nullable=True))
    op.create_foreign_key("fk_tasks_parent_task_id", "tasks", "tasks", ["parent_task_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_tasks_parent_task_id", "tasks", ["parent_task_id"])
    op.execute("UPDATE tasks SET progress_percent = 0 WHERE progress_percent IS NULL")
    op.alter_column("tasks", "progress_percent", server_default=None)
    op.alter_column("tasks", "key_results", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_tasks_parent_task_id", table_name="tasks")
    op.drop_constraint("fk_tasks_parent_task_id", "tasks", type_="foreignkey")
    op.drop_column("tasks", "deadline")
    op.drop_column("tasks", "owner_name")
    op.drop_column("tasks", "owner_type")
    op.drop_column("tasks", "key_results")
    op.drop_column("tasks", "status_summary")
    op.drop_column("tasks", "progress_percent")
    op.drop_column("tasks", "code")
    op.drop_column("tasks", "parent_task_id")

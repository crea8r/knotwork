"""Add projects, tasks, and project-scoped knowledge.

Revision ID: 0011_projects_tasks
Revises: 0010_graph_paths
Create Date: 2026-03-25
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0011_projects_tasks"
down_revision = "0010_graph_paths"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="open"),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_projects_workspace_id", "projects", ["workspace_id"])

    op.create_table(
        "project_status_updates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_type", sa.String(length=20), nullable=False, server_default="human"),
        sa.Column("author_name", sa.String(length=200), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_status_updates_project_id", "project_status_updates", ["project_id"])

    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="open"),
        sa.Column("origin_type", sa.String(length=50), nullable=False, server_default="manual"),
        sa.Column("origin_graph_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["origin_graph_id"], ["graphs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_workspace_id", "tasks", ["workspace_id"])
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"])

    op.add_column("graphs", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_graphs_project_id", "graphs", "projects", ["project_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_graphs_project_id", "graphs", ["project_id"])

    op.add_column("runs", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("runs", sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_runs_project_id", "runs", "projects", ["project_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_runs_task_id", "runs", "tasks", ["task_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_runs_project_id", "runs", ["project_id"])
    op.create_index("ix_runs_task_id", "runs", ["task_id"])

    op.add_column("channels", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("channels", sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_channels_project_id", "channels", "projects", ["project_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_channels_task_id", "channels", "tasks", ["task_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_channels_project_id", "channels", ["project_id"])
    op.create_index("ix_channels_task_id", "channels", ["task_id"])

    op.add_column("knowledge_files", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("knowledge_folders", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_knowledge_files_project_id", "knowledge_files", "projects", ["project_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_knowledge_folders_project_id", "knowledge_folders", "projects", ["project_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_knowledge_files_project_id", "knowledge_files", ["project_id"])
    op.create_index("ix_knowledge_folders_project_id", "knowledge_folders", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_folders_project_id", table_name="knowledge_folders")
    op.drop_index("ix_knowledge_files_project_id", table_name="knowledge_files")
    op.drop_constraint("fk_knowledge_folders_project_id", "knowledge_folders", type_="foreignkey")
    op.drop_constraint("fk_knowledge_files_project_id", "knowledge_files", type_="foreignkey")
    op.drop_column("knowledge_folders", "project_id")
    op.drop_column("knowledge_files", "project_id")

    op.drop_index("ix_channels_task_id", table_name="channels")
    op.drop_index("ix_channels_project_id", table_name="channels")
    op.drop_constraint("fk_channels_task_id", "channels", type_="foreignkey")
    op.drop_constraint("fk_channels_project_id", "channels", type_="foreignkey")
    op.drop_column("channels", "task_id")
    op.drop_column("channels", "project_id")

    op.drop_index("ix_runs_task_id", table_name="runs")
    op.drop_index("ix_runs_project_id", table_name="runs")
    op.drop_constraint("fk_runs_task_id", "runs", type_="foreignkey")
    op.drop_constraint("fk_runs_project_id", "runs", type_="foreignkey")
    op.drop_column("runs", "task_id")
    op.drop_column("runs", "project_id")

    op.drop_index("ix_graphs_project_id", table_name="graphs")
    op.drop_constraint("fk_graphs_project_id", "graphs", type_="foreignkey")
    op.drop_column("graphs", "project_id")

    op.drop_index("ix_tasks_project_id", table_name="tasks")
    op.drop_index("ix_tasks_workspace_id", table_name="tasks")
    op.drop_table("tasks")

    op.drop_index("ix_project_status_updates_project_id", table_name="project_status_updates")
    op.drop_table("project_status_updates")

    op.drop_index("ix_projects_workspace_id", table_name="projects")
    op.drop_table("projects")

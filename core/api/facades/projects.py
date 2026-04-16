"""Core facade for project APIs used across modules."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from modules.projects.backend import projects_service
from modules.projects.backend.projects_models import Objective, Project


async def render_project_context(db: AsyncSession, workspace_id: UUID, project_id: UUID | None) -> str:
    return await projects_service.render_project_context(db, workspace_id, project_id)


async def get_project_document_content(workspace_id: UUID, project_id: UUID, path: str):
    return await projects_service.get_project_document_content(workspace_id, project_id, path)


async def get_project_document_history(workspace_id: UUID, project_id: UUID, path: str):
    return await projects_service.get_project_document_history(workspace_id, project_id, path)


async def restore_project_document(
    db: AsyncSession,
    workspace_id: UUID,
    project_id: UUID,
    path: str,
    version_id: str,
    restored_by: str,
):
    return await projects_service.restore_project_document(
        db,
        workspace_id,
        project_id,
        path,
        version_id,
        restored_by,
    )


async def get_project(db: AsyncSession, project_id: UUID):
    return await db.get(Project, project_id)


async def get_objective(db: AsyncSession, objective_id: UUID):
    return await db.get(Objective, objective_id)

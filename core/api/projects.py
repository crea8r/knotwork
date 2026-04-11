from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from modules.projects.backend import projects_service


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

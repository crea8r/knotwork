from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from modules.assets.backend import knowledge_change_service, knowledge_service
from modules.assets.backend.storage import get_storage_adapter as _get_storage_adapter


async def list_files(db: AsyncSession, workspace_id: UUID, project_id: UUID | None = None):
    return await knowledge_service.list_files(db, workspace_id=workspace_id, project_id=project_id)


async def get_file_by_path(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    project_id: UUID | None = None,
):
    return await knowledge_service.get_file_by_path(db, workspace_id, path, project_id=project_id)


async def create_file(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    title: str | None,
    content: str,
    *,
    created_by: str,
    change_summary: str | None = None,
    project_id: UUID | None = None,
):
    return await knowledge_service.create_file(
        db,
        workspace_id,
        path,
        title,
        content,
        created_by=created_by,
        change_summary=change_summary,
        project_id=project_id,
    )


async def update_file(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    content: str,
    *,
    updated_by: str,
    change_summary: str | None = None,
    project_id: UUID | None = None,
):
    return await knowledge_service.update_file(
        db,
        workspace_id,
        path,
        content,
        updated_by=updated_by,
        change_summary=change_summary,
        project_id=project_id,
    )


def get_storage_adapter():
    return _get_storage_adapter()


async def update_inline_proposal_message(
    db: AsyncSession,
    *,
    channel_id,
    proposal_id,
    updates: dict,
) -> None:
    await knowledge_change_service.update_inline_proposal_message(
        db,
        channel_id=channel_id,
        proposal_id=proposal_id,
        updates=updates,
    )

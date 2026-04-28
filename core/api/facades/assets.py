"""Core facade for asset APIs used across modules."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from modules.assets.backend import knowledge_folder_service, knowledge_service


async def list_files(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    project_id: UUID | None = None,
):
    return await knowledge_service.list_files(db, workspace_id, project_id=project_id)


async def search_files(
    db: AsyncSession,
    workspace_id: UUID,
    query: str,
    *,
    project_id: UUID | None = None,
):
    return await knowledge_service.search_files(db, workspace_id, query, project_id=project_id)


async def get_file_by_path(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    *,
    project_id: UUID | None = None,
):
    return await knowledge_service.get_file_by_path(db, workspace_id, path, project_id=project_id)


async def read_file_content(
    workspace_id: UUID,
    path: str,
    *,
    project_id: UUID | None = None,
):
    return await knowledge_service.read_file_content(workspace_id, path, project_id=project_id)


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
    file_type: str = "md",
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
        file_type=file_type,
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


async def rename_file(
    db: AsyncSession,
    workspace_id: UUID,
    old_path: str,
    new_path: str,
    *,
    project_id: UUID | None = None,
):
    return await knowledge_service.rename_file(
        db,
        workspace_id,
        old_path,
        new_path,
        project_id=project_id,
    )


async def delete_file(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    *,
    deleted_by: str,
    project_id: UUID | None = None,
):
    await knowledge_service.delete_file(
        db,
        workspace_id,
        path,
        deleted_by=deleted_by,
        project_id=project_id,
    )


async def list_folders(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    project_id: UUID | None = None,
):
    return await knowledge_folder_service.list_folders(db, workspace_id, project_id=project_id)


async def create_folder(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    *,
    project_id: UUID | None = None,
):
    return await knowledge_folder_service.create_folder(db, workspace_id, path, project_id=project_id)


async def rename_folder(
    db: AsyncSession,
    workspace_id: UUID,
    old_path: str,
    new_path: str,
    *,
    project_id: UUID | None = None,
):
    await knowledge_folder_service.rename_folder(
        db,
        workspace_id,
        old_path,
        new_path,
        project_id=project_id,
    )


async def delete_folder(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    *,
    project_id: UUID | None = None,
):
    await knowledge_folder_service.delete_folder(db, workspace_id, path, project_id=project_id)


async def get_history(
    workspace_id: UUID,
    path: str,
    *,
    project_id: UUID | None = None,
):
    return await knowledge_service.get_history(workspace_id, path, project_id=project_id)


async def restore_version(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    version_id: str,
    restored_by: str,
    *,
    project_id: UUID | None = None,
):
    return await knowledge_service.restore_version(
        db,
        workspace_id,
        path,
        version_id,
        restored_by,
        project_id=project_id,
    )


async def store_raw_file(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    title: str,
    raw_bytes: bytes,
    file_type: str,
    agent_md: str,
    *,
    created_by: str,
    project_id: UUID | None = None,
):
    return await knowledge_service.store_raw_file(
        db,
        workspace_id,
        path,
        title,
        raw_bytes,
        file_type,
        agent_md,
        created_by,
        project_id=project_id,
    )

"""Core facade for asset/knowledge APIs used across modules."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.assets.backend import knowledge_change_service, knowledge_folder_service, knowledge_service
from modules.assets.backend.knowledge_models import KnowledgeChange, KnowledgeFile, KnowledgeFolder
from modules.assets.backend.knowledge_proposals_router import _apply_change as _apply_knowledge_change
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


async def get_file(db: AsyncSession, file_id: UUID):
    return await db.get(KnowledgeFile, file_id)


async def get_folder(db: AsyncSession, folder_id: UUID):
    return await db.get(KnowledgeFolder, folder_id)


async def get_folder_by_path(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    *,
    project_id: UUID | None = None,
):
    result = await db.execute(
        select(KnowledgeFolder).where(
            KnowledgeFolder.workspace_id == workspace_id,
            KnowledgeFolder.project_id == project_id if project_id is not None else KnowledgeFolder.project_id.is_(None),
            KnowledgeFolder.path == path,
        ).limit(1)
    )
    return result.scalar_one_or_none()


async def create_folder(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    *,
    project_id: UUID | None = None,
):
    if project_id is None:
        return await knowledge_folder_service.create_folder(db, workspace_id, path)
    folder = await get_folder_by_path(db, workspace_id, path, project_id=project_id)
    if folder is not None:
        return folder
    folder = KnowledgeFolder(workspace_id=workspace_id, project_id=project_id, path=path)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


async def list_pending_changes(db: AsyncSession, workspace_id: UUID) -> list[KnowledgeChange]:
    result = await db.execute(
        select(KnowledgeChange)
        .where(
            KnowledgeChange.workspace_id == workspace_id,
            KnowledgeChange.status == "pending",
        )
        .order_by(KnowledgeChange.created_at.desc())
    )
    return list(result.scalars())


async def get_change(db: AsyncSession, change_id: UUID):
    return await db.get(KnowledgeChange, change_id)


async def apply_change(
    db: AsyncSession,
    workspace_id: UUID,
    change,
    final_content: str | None,
) -> None:
    await _apply_knowledge_change(db, workspace_id, change, final_content)


async def create_change(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    path: str,
    proposed_content: str,
    reason: str,
    run_id: str | None,
    node_id: str | None,
    agent_ref: str | None = None,
    source_channel_id: str | None = None,
    action_type: str = "update_content",
    target_type: str = "file",
    payload: dict | None = None,
):
    parsed_source_channel_id = UUID(source_channel_id) if source_channel_id else None
    return await knowledge_change_service.create_knowledge_change(
        db,
        workspace_id=workspace_id,
        path=path,
        proposed_content=proposed_content,
        reason=reason,
        run_id=run_id,
        node_id=node_id,
        agent_ref=agent_ref,
        source_channel_id=parsed_source_channel_id,
        action_type=action_type,
        target_type=target_type,
        payload=payload,
    )

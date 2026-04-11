"""
Folder CRUD service.

Folders are stored explicitly in DB to support empty folders (Windows Explorer UX).
When a folder is deleted, all files inside it are also deleted.
When a folder is renamed, all child file paths are updated.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from .knowledge_models import KnowledgeFile, KnowledgeFolder
from .storage import get_storage_adapter


async def list_folders(db: AsyncSession, workspace_id: UUID) -> list[KnowledgeFolder]:
    result = await db.execute(
        select(KnowledgeFolder).where(
            KnowledgeFolder.workspace_id == workspace_id,
            KnowledgeFolder.project_id.is_(None),
        )
    )
    return list(result.scalars().all())


async def create_folder(db: AsyncSession, workspace_id: UUID, path: str) -> KnowledgeFolder:
    """Create an empty folder. Idempotent — returns existing if path already exists."""
    existing = await db.execute(
        select(KnowledgeFolder).where(
            KnowledgeFolder.workspace_id == workspace_id,
            KnowledgeFolder.project_id.is_(None),
            KnowledgeFolder.path == path,
        )
    )
    folder = existing.scalars().first()
    if folder:
        return folder
    folder = KnowledgeFolder(workspace_id=workspace_id, project_id=None, path=path)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


async def delete_folder(db: AsyncSession, workspace_id: UUID, path: str) -> None:
    """Delete folder record and all files whose path starts with this folder."""
    adapter = get_storage_adapter()
    prefix = path + "/"

    files_result = await db.execute(
        select(KnowledgeFile).where(
            KnowledgeFile.workspace_id == workspace_id,
            KnowledgeFile.project_id.is_(None),
        )
    )
    for f in files_result.scalars().all():
        if f.path == path or f.path.startswith(prefix):
            try:
                await adapter.delete(str(workspace_id), f.path)
            except Exception:
                pass
            await db.delete(f)

    # Collect folder paths to delete, then issue a single delete
    folders_result = await db.execute(
        select(KnowledgeFolder).where(
            KnowledgeFolder.workspace_id == workspace_id,
            KnowledgeFolder.project_id.is_(None),
        )
    )
    paths_to_delete = [
        row.path for row in folders_result.scalars().all()
        if row.path == path or row.path.startswith(prefix)
    ]
    if paths_to_delete:
        await db.execute(
            delete(KnowledgeFolder).where(
                KnowledgeFolder.workspace_id == workspace_id,
                KnowledgeFolder.project_id.is_(None),
                KnowledgeFolder.path.in_(paths_to_delete),
            )
        )
    await db.commit()


async def rename_folder(
    db: AsyncSession,
    workspace_id: UUID,
    old_path: str,
    new_path: str,
) -> None:
    """Rename folder: move all files and sub-folder records to new path prefix."""
    adapter = get_storage_adapter()
    prefix = old_path + "/"

    # Update files
    files_result = await db.execute(
        select(KnowledgeFile).where(
            KnowledgeFile.workspace_id == workspace_id,
            KnowledgeFile.project_id.is_(None),
        )
    )
    for f in files_result.scalars().all():
        if f.path.startswith(prefix):
            new_file_path = new_path + "/" + f.path[len(prefix):]
            try:
                await adapter.move(str(workspace_id), f.path, new_file_path, "system")
            except Exception:
                pass
            f.path = new_file_path

    # Update folder records
    folders_result = await db.execute(
        select(KnowledgeFolder).where(
            KnowledgeFolder.workspace_id == workspace_id,
            KnowledgeFolder.project_id.is_(None),
        )
    )
    for folder in folders_result.scalars().all():
        if folder.path == old_path:
            folder.path = new_path
        elif folder.path.startswith(prefix):
            folder.path = new_path + "/" + folder.path[len(prefix):]

    await db.commit()

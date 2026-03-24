"""
Knowledge file CRUD service.

Coordinates between StorageAdapter (file bytes/versions) and the DB
(KnowledgeFile metadata, health score cache).
"""
from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.knowledge.models import KnowledgeFile
from knotwork.knowledge.storage import get_storage_adapter
from knotwork.knowledge.storage.adapter import FileVersion


def _count_tokens(content: str) -> int:
    return max(1, len(content) // 4)


def _extract_links(content: str) -> list[str]:
    return re.findall(r"\[\[([^\]]+)\]\]", content)


def _derive_title(path: str) -> str:
    filename = path.split("/")[-1]
    stem = filename.rsplit(".", 1)[0]
    return stem or filename


async def list_files(db: AsyncSession, workspace_id: UUID) -> list[KnowledgeFile]:
    result = await db.execute(
        select(KnowledgeFile).where(KnowledgeFile.workspace_id == workspace_id)
    )
    return list(result.scalars().all())


async def search_files(db: AsyncSession, workspace_id: UUID, query: str) -> list[KnowledgeFile]:
    q = query.strip().lower()
    if not q:
        return await list_files(db, workspace_id)
    files = await list_files(db, workspace_id)
    adapter = get_storage_adapter()
    out: list[KnowledgeFile] = []
    for f in files:
        if q in f.path.lower() or q in f.title.lower():
            out.append(f)
            continue
        if not f.is_editable:
            continue  # skip binary files for content search
        try:
            fc = await adapter.read(str(workspace_id), f.path)
            if q in fc.content.lower():
                out.append(f)
        except Exception:
            continue
    return out


async def get_file_by_path(db: AsyncSession, workspace_id: UUID, path: str) -> KnowledgeFile | None:
    result = await db.execute(
        select(KnowledgeFile).where(
            KnowledgeFile.workspace_id == workspace_id,
            KnowledgeFile.path == path,
        )
    )
    return result.scalars().first()


async def create_file(
    db: AsyncSession, workspace_id: UUID, path: str, title: str | None, content: str,
    created_by: str, change_summary: str | None = None,
) -> KnowledgeFile:
    kf = await get_file_by_path(db, workspace_id, path)
    if kf is not None:
        raise ValueError(f'File "{path}" already exists')

    adapter = get_storage_adapter()
    version_id = await adapter.write(str(workspace_id), path, content,
                                     saved_by=created_by, change_summary=change_summary)
    token_count = _count_tokens(content)
    links = _extract_links(content)
    resolved_title = title.strip() if title and title.strip() else _derive_title(path)

    kf = KnowledgeFile(
        workspace_id=workspace_id, path=path, title=resolved_title,
        raw_token_count=token_count, resolved_token_count=token_count,
        linked_paths=links, current_version_id=version_id,
    )
    db.add(kf)

    await db.commit()
    await db.refresh(kf)
    return kf


async def update_file(
    db: AsyncSession, workspace_id: UUID, path: str, content: str,
    updated_by: str, change_summary: str | None = None,
) -> KnowledgeFile:
    kf = await get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise FileNotFoundError(path)
    adapter = get_storage_adapter()
    version_id = await adapter.write(str(workspace_id), path, content,
                                     saved_by=updated_by, change_summary=change_summary)
    kf.raw_token_count = _count_tokens(content)
    kf.resolved_token_count = kf.raw_token_count
    kf.linked_paths = _extract_links(content)
    kf.current_version_id = version_id
    await db.commit()
    await db.refresh(kf)
    return kf


async def delete_file(db: AsyncSession, workspace_id: UUID, path: str, deleted_by: str) -> None:
    kf = await get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise FileNotFoundError(path)
    adapter = get_storage_adapter()
    await adapter.delete(str(workspace_id), path)
    await db.delete(kf)
    await db.commit()


async def rename_file(
    db: AsyncSession, workspace_id: UUID, old_path: str, new_path: str,
) -> KnowledgeFile:
    """Move/rename a file to new_path. Updates storage and DB record."""
    kf = await get_file_by_path(db, workspace_id, old_path)
    if kf is None:
        raise FileNotFoundError(old_path)
    existing = await get_file_by_path(db, workspace_id, new_path)
    if existing is not None and existing.id != kf.id:
        raise ValueError(f'File "{new_path}" already exists')
    adapter = get_storage_adapter()
    new_version_id = await adapter.move(str(workspace_id), old_path, new_path, "system")
    kf.path = new_path
    kf.current_version_id = new_version_id
    await db.commit()
    await db.refresh(kf)
    return kf


async def store_raw_file(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    title: str,
    raw_bytes: bytes,
    file_type: str,  # 'pdf' | 'docx' | 'image' | 'other'
    agent_md: str,
    created_by: str,
) -> KnowledgeFile:
    """
    Store a binary file as view-only. The raw bytes go to storage._raw/,
    agent_md (extracted text for LLM context) goes as the text version.
    """
    adapter = get_storage_adapter()
    await adapter.write_raw(str(workspace_id), path, raw_bytes)
    version_id = await adapter.write(str(workspace_id), path, agent_md,
                                     saved_by=created_by, change_summary="Initial binary upload")
    token_count = _count_tokens(agent_md)

    kf = await get_file_by_path(db, workspace_id, path)
    if kf is None:
        kf = KnowledgeFile(
            workspace_id=workspace_id, path=path, title=title,
            raw_token_count=token_count, resolved_token_count=token_count,
            linked_paths=[], current_version_id=version_id,
            file_type=file_type, is_editable=False,
        )
        db.add(kf)
    else:
        kf.title = title
        kf.raw_token_count = token_count
        kf.resolved_token_count = token_count
        kf.current_version_id = version_id
        kf.file_type = file_type
        kf.is_editable = False

    await db.commit()
    await db.refresh(kf)
    return kf


async def get_history(workspace_id: str, path: str) -> list[FileVersion]:
    adapter = get_storage_adapter()
    return await adapter.history(workspace_id, path)


async def restore_version(
    db: AsyncSession, workspace_id: UUID, path: str, version_id: str, restored_by: str,
) -> KnowledgeFile:
    adapter = get_storage_adapter()
    new_version_id = await adapter.restore(str(workspace_id), path, version_id, restored_by)
    kf = await get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise FileNotFoundError(path)
    fc = await adapter.read(str(workspace_id), path)
    kf.raw_token_count = _count_tokens(fc.content)
    kf.resolved_token_count = kf.raw_token_count
    kf.linked_paths = _extract_links(fc.content)
    kf.current_version_id = new_version_id
    await db.commit()
    await db.refresh(kf)
    return kf

"""
Knowledge file CRUD service.

Coordinates between StorageAdapter (file bytes/versions) and the DB
(KnowledgeFile metadata, health score cache).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.knowledge.models import KnowledgeFile
from knotwork.knowledge.storage import get_storage_adapter
from knotwork.knowledge.storage.adapter import FileVersion


def _count_tokens(content: str) -> int:
    """Approximate token count using 4 chars/token heuristic."""
    return max(1, len(content) // 4)


def _extract_links(content: str) -> list[str]:
    """Extract [[wiki-link]] targets from markdown content."""
    return re.findall(r"\[\[([^\]]+)\]\]", content)


async def list_files(db: AsyncSession, workspace_id: UUID) -> list[KnowledgeFile]:
    result = await db.execute(
        select(KnowledgeFile).where(KnowledgeFile.workspace_id == workspace_id)
    )
    return list(result.scalars().all())


async def search_files(db: AsyncSession, workspace_id: UUID, query: str) -> list[KnowledgeFile]:
    """Naive full-text search over path/title/content."""
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
        try:
            fc = await adapter.read(str(workspace_id), f.path)
            if q in fc.content.lower():
                out.append(f)
        except Exception:
            # Skip files missing in storage or unreadable.
            continue
    return out


async def get_file_by_path(
    db: AsyncSession, workspace_id: UUID, path: str
) -> KnowledgeFile | None:
    result = await db.execute(
        select(KnowledgeFile).where(
            KnowledgeFile.workspace_id == workspace_id,
            KnowledgeFile.path == path,
        )
    )
    return result.scalars().first()


async def create_file(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    title: str,
    content: str,
    created_by: str,
    change_summary: str | None = None,
) -> KnowledgeFile:
    adapter = get_storage_adapter()
    version_id = await adapter.write(
        str(workspace_id), path, content,
        saved_by=created_by, change_summary=change_summary,
    )
    token_count = _count_tokens(content)
    links = _extract_links(content)

    # Upsert: if record exists (e.g. was deleted), restore it
    kf = await get_file_by_path(db, workspace_id, path)
    if kf is None:
        kf = KnowledgeFile(
            workspace_id=workspace_id,
            path=path,
            title=title,
            raw_token_count=token_count,
            resolved_token_count=token_count,
            linked_paths=links,
            current_version_id=version_id,
        )
        db.add(kf)
    else:
        kf.title = title
        kf.raw_token_count = token_count
        kf.resolved_token_count = token_count
        kf.linked_paths = links
        kf.current_version_id = version_id

    await db.commit()
    await db.refresh(kf)
    return kf


async def update_file(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    content: str,
    updated_by: str,
    change_summary: str | None = None,
) -> KnowledgeFile:
    kf = await get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise FileNotFoundError(path)

    adapter = get_storage_adapter()
    version_id = await adapter.write(
        str(workspace_id), path, content,
        saved_by=updated_by, change_summary=change_summary,
    )
    kf.raw_token_count = _count_tokens(content)
    kf.resolved_token_count = kf.raw_token_count
    kf.linked_paths = _extract_links(content)
    kf.current_version_id = version_id

    await db.commit()
    await db.refresh(kf)
    return kf


async def delete_file(
    db: AsyncSession, workspace_id: UUID, path: str, deleted_by: str
) -> None:
    kf = await get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise FileNotFoundError(path)
    adapter = get_storage_adapter()
    await adapter.delete(str(workspace_id), path)
    await db.delete(kf)
    await db.commit()


async def get_history(workspace_id: str, path: str) -> list[FileVersion]:
    adapter = get_storage_adapter()
    return await adapter.history(workspace_id, path)


async def restore_version(
    db: AsyncSession,
    workspace_id: UUID,
    path: str,
    version_id: str,
    restored_by: str,
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

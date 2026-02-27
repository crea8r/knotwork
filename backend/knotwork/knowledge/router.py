"""
Handbook (knowledge file) REST endpoints.

All paths use path as a query param (?path=) to avoid URL encoding issues with slashes.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.knowledge import service as svc
from knotwork.knowledge.health import compute_health_score
from knotwork.knowledge.schemas import (
    FileVersionOut,
    KnowledgeFileCreate,
    KnowledgeFileOut,
    KnowledgeFileUpdate,
    KnowledgeFileWithContent,
    KnowledgeRestoreRequest,
    SuggestionOut,
)
from knotwork.knowledge.storage import get_storage_adapter
from knotwork.knowledge.suggestions import generate_suggestions

router = APIRouter(prefix="/workspaces", tags=["knowledge"])


@router.get("/{workspace_id}/knowledge", response_model=list[KnowledgeFileOut])
async def list_knowledge_files(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.list_files(db, workspace_id)


@router.post("/{workspace_id}/knowledge", response_model=KnowledgeFileOut, status_code=201)
async def create_knowledge_file(
    workspace_id: UUID,
    body: KnowledgeFileCreate,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc.create_file(
            db, workspace_id,
            body.path, body.title, body.content,
            created_by="system", change_summary=body.change_summary,
        )
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.get("/{workspace_id}/knowledge/file", response_model=KnowledgeFileWithContent)
async def get_knowledge_file(
    workspace_id: UUID,
    path: str,
    db: AsyncSession = Depends(get_db),
):
    kf = await svc.get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise HTTPException(404, "File not found")
    adapter = get_storage_adapter()
    try:
        fc = await adapter.read(str(workspace_id), path)
    except FileNotFoundError:
        raise HTTPException(404, "File content not found in storage")
    return KnowledgeFileWithContent(
        **KnowledgeFileOut.model_validate(kf).model_dump(),
        content=fc.content,
        version_id=fc.version_id,
    )


@router.put("/{workspace_id}/knowledge/file", response_model=KnowledgeFileOut)
async def update_knowledge_file(
    workspace_id: UUID,
    path: str,
    body: KnowledgeFileUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc.update_file(db, workspace_id, path, body.content, "system", body.change_summary)
    except FileNotFoundError:
        raise HTTPException(404, "File not found")


@router.delete("/{workspace_id}/knowledge/file", status_code=204)
async def delete_knowledge_file(
    workspace_id: UUID,
    path: str,
    db: AsyncSession = Depends(get_db),
):
    try:
        await svc.delete_file(db, workspace_id, path, "system")
    except FileNotFoundError:
        raise HTTPException(404, "File not found")


@router.get("/{workspace_id}/knowledge/history", response_model=list[FileVersionOut])
async def get_file_history(workspace_id: UUID, path: str):
    versions = await svc.get_history(str(workspace_id), path)
    return [
        FileVersionOut(
            version_id=v.version_id,
            saved_at=v.saved_at,
            saved_by=v.saved_by,
            change_summary=v.change_summary,
        )
        for v in versions
    ]


@router.post("/{workspace_id}/knowledge/restore", response_model=KnowledgeFileOut)
async def restore_file_version(
    workspace_id: UUID,
    path: str,
    body: KnowledgeRestoreRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc.restore_version(db, workspace_id, path, body.version_id, body.restored_by)
    except FileNotFoundError:
        raise HTTPException(404, "File or version not found")


@router.get("/{workspace_id}/knowledge/health")
async def get_knowledge_health(
    workspace_id: UUID,
    path: str,
    db: AsyncSession = Depends(get_db),
):
    kf = await svc.get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise HTTPException(404, "File not found")
    score = await compute_health_score(kf.id, db)
    return {"path": path, "health_score": score}


@router.get("/{workspace_id}/knowledge/suggestions", response_model=SuggestionOut)
async def get_knowledge_suggestions(
    workspace_id: UUID,
    path: str,
    db: AsyncSession = Depends(get_db),
):
    kf = await svc.get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise HTTPException(404, "File not found")
    suggestions = await generate_suggestions(kf.id, db)
    return SuggestionOut(suggestions=suggestions, health_score=kf.health_score)

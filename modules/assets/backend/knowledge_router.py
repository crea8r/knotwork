"""
Workspace asset file REST endpoints.

All targeted file reads use ?path= query params to avoid URL encoding issues with slashes.
Upload, raw serving, and folder endpoints are in separate routers.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db

from . import knowledge_service as svc
from .knowledge_change_summary import generate_change_summary
from .knowledge_health import compute_health_score
from .knowledge_schemas import (
    FileVersionOut,
    KnowledgeFileCreate,
    KnowledgeFileOut,
    KnowledgeFileUpdate,
    KnowledgeFileWithContent,
    KnowledgeRestoreRequest,
    RenameFileRequest,
    SuggestionOut,
)
from .knowledge_suggestions import generate_suggestions
from .presentation_codec import (
    PRESENTATION_FILE_TYPE,
    PRESENTATION_MIME,
    export_presentation_bytes,
    presentation_from_storage_content,
)

router = APIRouter(prefix="/workspaces", tags=["assets"])


@router.get("/{workspace_id}/assets/workspace/files", response_model=list[KnowledgeFileOut])
async def list_knowledge_files(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.list_files(db, workspace_id)


@router.get("/{workspace_id}/assets/workspace/files/search", response_model=list[KnowledgeFileOut])
async def search_knowledge_files(
    workspace_id: UUID,
    q: str,
    db: AsyncSession = Depends(get_db),
):
    return await svc.search_files(db, workspace_id, q)


@router.post("/{workspace_id}/assets/workspace/files", response_model=KnowledgeFileOut, status_code=201)
async def create_knowledge_file(
    workspace_id: UUID,
    body: KnowledgeFileCreate,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc.create_file(
            db, workspace_id, body.path, body.title, body.content,
            created_by="system", change_summary=body.change_summary,
            file_type=body.file_type,
        )
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.get("/{workspace_id}/assets/workspace/files/by-path", response_model=KnowledgeFileWithContent)
async def get_knowledge_file(
    workspace_id: UUID,
    path: str,
    db: AsyncSession = Depends(get_db),
):
    kf = await svc.get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise HTTPException(404, "File not found")
    try:
        fc = await svc.read_file_content(workspace_id, path)
    except FileNotFoundError:
        raise HTTPException(404, "File content not found in storage")
    return KnowledgeFileWithContent(
        **KnowledgeFileOut.model_validate(kf).model_dump(),
        content=fc.content, version_id=fc.version_id,
    )


@router.put("/{workspace_id}/assets/workspace/files/by-path", response_model=KnowledgeFileOut)
async def update_knowledge_file(
    workspace_id: UUID,
    path: str,
    body: KnowledgeFileUpdate,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc.update_file(
            db, workspace_id, path, body.content, "system", body.change_summary
        )
    except FileNotFoundError:
        raise HTTPException(404, "File not found")


@router.get("/{workspace_id}/assets/workspace/files/by-path/export")
async def export_knowledge_file(
    workspace_id: UUID,
    path: str,
    db: AsyncSession = Depends(get_db),
):
    kf = await svc.get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise HTTPException(404, "File not found")
    if kf.file_type != PRESENTATION_FILE_TYPE:
        raise HTTPException(400, "Export is only available for presentation files")
    try:
        fc = await svc.read_file_content(workspace_id, path)
        deck = presentation_from_storage_content(fc.content, fallback_title=kf.title)
        payload = export_presentation_bytes(deck)
    except FileNotFoundError:
        raise HTTPException(404, "File content not found in storage")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    filename = path.split("/")[-1]
    return Response(
        content=payload,
        media_type=PRESENTATION_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/{workspace_id}/assets/workspace/files/by-path/rename", response_model=KnowledgeFileOut)
async def rename_knowledge_file(
    workspace_id: UUID,
    path: str,
    body: RenameFileRequest,
    db: AsyncSession = Depends(get_db),
):
    """Rename or move a file to a new path."""
    try:
        return await svc.rename_file(db, workspace_id, path, body.new_path)
    except FileNotFoundError:
        raise HTTPException(404, "File not found")
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.delete("/{workspace_id}/assets/workspace/files/by-path", status_code=204)
async def delete_knowledge_file(
    workspace_id: UUID,
    path: str,
    db: AsyncSession = Depends(get_db),
):
    try:
        await svc.delete_file(db, workspace_id, path, "system")
    except FileNotFoundError:
        raise HTTPException(404, "File not found")


@router.get("/{workspace_id}/assets/workspace/files/history", response_model=list[FileVersionOut])
async def get_file_history(
    workspace_id: UUID,
    path: str,
):
    versions = await svc.get_history(workspace_id, path)
    return [FileVersionOut(version_id=v.version_id, saved_at=v.saved_at,
                           saved_by=v.saved_by, change_summary=v.change_summary) for v in versions]


@router.post("/{workspace_id}/assets/workspace/files/restore", response_model=KnowledgeFileOut)
async def restore_file_version(
    workspace_id: UUID,
    path: str,
    body: KnowledgeRestoreRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc.restore_version(
            db,
            workspace_id,
            path,
            body.version_id,
            body.restored_by,
        )
    except FileNotFoundError:
        raise HTTPException(404, "File or version not found")


@router.get("/{workspace_id}/assets/workspace/files/health")
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


@router.get("/{workspace_id}/assets/workspace/files/suggestions", response_model=SuggestionOut)
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


@router.post("/{workspace_id}/assets/workspace/files/summarize-diff")
async def summarize_knowledge_diff(
    workspace_id: UUID,
    path: str,
    body: KnowledgeFileUpdate,
    db: AsyncSession = Depends(get_db),
):
    kf = await svc.get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise HTTPException(404, "File not found")
    try:
        fc = await svc.read_file_content(workspace_id, path)
    except FileNotFoundError:
        raise HTTPException(404, "File content not found in storage")
    summary = await generate_change_summary(path, fc.content, body.content)
    return {"summary": summary}

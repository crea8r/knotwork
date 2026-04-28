from __future__ import annotations

from pathlib import Path as _Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import projects as core_projects
from libs.database import get_db

from . import knowledge_folder_service, knowledge_service
from .knowledge_change_summary import generate_change_summary
from .knowledge_health import compute_health_score
from .knowledge_schemas import (
    CreateFolderRequest,
    FileVersionOut,
    KnowledgeFileCreate,
    KnowledgeFileOut,
    KnowledgeFileUpdate,
    KnowledgeFileWithContent,
    KnowledgeFolderOut,
    KnowledgeRestoreRequest,
    RenameFileRequest,
    RenameFolderRequest,
    SuggestionOut,
)
from .knowledge_suggestions import generate_suggestions
from .knowledge_conversion import suggested_path
from .knowledge_conversion_vision import convert_with_vision

router = APIRouter(prefix="/workspaces", tags=["assets"])


async def _resolve_project(workspace_id: UUID, project_ref: str, db: AsyncSession):
    project = await core_projects.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    return project


@router.get("/{workspace_id}/assets/project/{project_ref}/files", response_model=list[KnowledgeFileOut])
async def list_project_asset_files(
    workspace_id: UUID,
    project_ref: str,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    return await knowledge_service.list_files(db, workspace_id, project_id=project.id)


@router.get("/{workspace_id}/assets/project/{project_ref}/files/search", response_model=list[KnowledgeFileOut])
async def search_project_asset_files(
    workspace_id: UUID,
    project_ref: str,
    q: str,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    return await knowledge_service.search_files(db, workspace_id, q, project_id=project.id)


@router.post("/{workspace_id}/assets/project/{project_ref}/files", response_model=KnowledgeFileOut, status_code=201)
async def create_project_asset_file(
    workspace_id: UUID,
    project_ref: str,
    body: KnowledgeFileCreate,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    try:
        return await knowledge_service.create_file(
            db,
            workspace_id,
            body.path,
            body.title,
            body.content,
            created_by="system",
            change_summary=body.change_summary,
            project_id=project.id,
            file_type=body.file_type,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/{workspace_id}/assets/project/{project_ref}/files/by-path", response_model=KnowledgeFileWithContent)
async def get_project_asset_file(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    file = await knowledge_service.get_file_by_path(db, workspace_id, path, project_id=project.id)
    if file is None:
        raise HTTPException(404, "Project asset file not found")
    try:
        content = await knowledge_service.read_file_content(workspace_id, path, project_id=project.id)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Project asset file content not found") from exc
    return KnowledgeFileWithContent(
        **KnowledgeFileOut.model_validate(file).model_dump(),
        content=content.content,
        version_id=content.version_id,
    )


@router.put("/{workspace_id}/assets/project/{project_ref}/files/by-path", response_model=KnowledgeFileOut)
async def update_project_asset_file(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    body: KnowledgeFileUpdate = ...,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    try:
        return await knowledge_service.update_file(
            db,
            workspace_id,
            path,
            body.content,
            updated_by="system",
            change_summary=body.change_summary,
            project_id=project.id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, "Project asset file not found") from exc


@router.patch("/{workspace_id}/assets/project/{project_ref}/files/by-path/rename", response_model=KnowledgeFileOut)
async def rename_project_asset_file(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    body: RenameFileRequest = ...,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    try:
        return await knowledge_service.rename_file(
            db,
            workspace_id,
            path,
            body.new_path,
            project_id=project.id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, "Project asset file not found") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/{workspace_id}/assets/project/{project_ref}/files/by-path", status_code=204)
async def delete_project_asset_file(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    try:
        await knowledge_service.delete_file(
            db,
            workspace_id,
            path,
            deleted_by="system",
            project_id=project.id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, "Project asset file not found") from exc


@router.get("/{workspace_id}/assets/project/{project_ref}/files/history", response_model=list[FileVersionOut])
async def get_project_asset_file_history(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    versions = await knowledge_service.get_history(workspace_id, path, project_id=project.id)
    return [
        FileVersionOut(
            version_id=version.version_id,
            saved_at=version.saved_at,
            saved_by=version.saved_by,
            change_summary=version.change_summary,
        )
        for version in versions
    ]


@router.post("/{workspace_id}/assets/project/{project_ref}/files/restore", response_model=KnowledgeFileOut)
async def restore_project_asset_file(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    body: KnowledgeRestoreRequest = ...,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    try:
        return await knowledge_service.restore_version(
            db,
            workspace_id,
            path,
            body.version_id,
            body.restored_by,
            project_id=project.id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, "Project asset file or version not found") from exc


@router.get("/{workspace_id}/assets/project/{project_ref}/files/health")
async def get_project_asset_file_health(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    file = await knowledge_service.get_file_by_path(db, workspace_id, path, project_id=project.id)
    if file is None:
        raise HTTPException(404, "Project asset file not found")
    return {"path": path, "health_score": await compute_health_score(file.id, db)}


@router.get("/{workspace_id}/assets/project/{project_ref}/files/suggestions", response_model=SuggestionOut)
async def get_project_asset_file_suggestions(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    file = await knowledge_service.get_file_by_path(db, workspace_id, path, project_id=project.id)
    if file is None:
        raise HTTPException(404, "Project asset file not found")
    suggestions = await generate_suggestions(file.id, db)
    return SuggestionOut(suggestions=suggestions, health_score=file.health_score)


@router.post("/{workspace_id}/assets/project/{project_ref}/files/summarize-diff")
async def summarize_project_asset_file_diff(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    body: KnowledgeFileUpdate = ...,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    file = await knowledge_service.get_file_by_path(db, workspace_id, path, project_id=project.id)
    if file is None:
        raise HTTPException(404, "Project asset file not found")
    try:
        existing = await knowledge_service.read_file_content(workspace_id, path, project_id=project.id)
    except FileNotFoundError as exc:
        raise HTTPException(404, "Project asset file content not found") from exc
    return {"summary": await generate_change_summary(path, existing.content, body.content)}


@router.get("/{workspace_id}/assets/project/{project_ref}/folders", response_model=list[KnowledgeFolderOut])
async def list_project_asset_folders(
    workspace_id: UUID,
    project_ref: str,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    return await knowledge_folder_service.list_folders(db, workspace_id, project_id=project.id)


@router.post("/{workspace_id}/assets/project/{project_ref}/folders", response_model=KnowledgeFolderOut, status_code=201)
async def create_project_asset_folder(
    workspace_id: UUID,
    project_ref: str,
    body: CreateFolderRequest,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    path = body.path.strip("/")
    if not path:
        raise HTTPException(400, "Folder path cannot be empty")
    return await knowledge_folder_service.create_folder(db, workspace_id, path, project_id=project.id)


@router.patch("/{workspace_id}/assets/project/{project_ref}/folders", status_code=204)
async def rename_project_asset_folder(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    body: RenameFolderRequest = ...,
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    new_path = body.new_path.strip("/")
    if not new_path:
        raise HTTPException(400, "Folder path cannot be empty")
    if new_path == path:
        return
    await knowledge_folder_service.rename_folder(
        db,
        workspace_id,
        path,
        new_path,
        project_id=project.id,
    )


@router.delete("/{workspace_id}/assets/project/{project_ref}/folders", status_code=204)
async def delete_project_asset_folder(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)
    await knowledge_folder_service.delete_folder(db, workspace_id, path, project_id=project.id)


@router.post("/{workspace_id}/assets/project/{project_ref}/uploads/preview")
async def upload_project_asset_preview(
    workspace_id: UUID,
    project_ref: str,
    file: UploadFile = File(...),
    folder: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
):
    project = await _resolve_project(workspace_id, project_ref, db)

    max_bytes = 10 * 1024 * 1024
    content = await file.read()
    if len(content) > max_bytes:
        raise HTTPException(400, "File is too large (max 10 MB)")

    filename = file.filename or "upload.txt"
    suffix = _Path(filename).suffix.lower()
    from .knowledge_conversion import VIDEO_EXTS

    if suffix in VIDEO_EXTS:
        raise HTTPException(400, {
            "error": "video_not_supported",
            "message": "Video files aren't supported yet — we're working on it!",
        })

    try:
        markdown, fmt = await convert_with_vision(filename, content)
    except (ValueError, Exception) as exc:
        raise HTTPException(422, f"Conversion failed: {exc}") from exc

    path = suggested_path(filename, folder)
    title = _Path(filename).stem.replace("-", " ").replace("_", " ").title()
    return {
        "suggested_path": path,
        "suggested_title": title,
        "converted_content": markdown,
        "format": fmt,
        "original_filename": filename,
        "asset_type": "md",
        "summary": None,
        "project_id": str(project.id),
    }

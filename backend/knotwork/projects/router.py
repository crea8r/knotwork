from __future__ import annotations

from pathlib import Path as _Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels.schemas import ChannelOut
from knotwork.database import get_db
from knotwork.knowledge.schemas import CreateFolderRequest, FileVersionOut, KnowledgeFolderOut, KnowledgeRestoreRequest, RenameFolderRequest, SuggestionOut
from knotwork.projects import service
from knotwork.projects.schemas import (
    ObjectiveCreate,
    ObjectiveOut,
    ObjectiveUpdate,
    ProjectCreate,
    ProjectDashboardOut,
    ProjectDocumentCreate,
    ProjectDocumentRename,
    ProjectDocumentOut,
    ProjectDocumentUpdate,
    ProjectDocumentWithContent,
    ProjectOut,
    ProjectStatusUpdateCreate,
    ProjectStatusUpdateOut,
    ProjectUpdate,
)


router = APIRouter(prefix="/workspaces", tags=["projects"])


@router.get("/{workspace_id}/projects", response_model=list[ProjectOut])
async def list_projects(workspace_id: UUID, db: AsyncSession = Depends(get_db)):
    rows = await service.list_projects(db, workspace_id)
    return [ProjectOut.model_validate(row) for row in rows]


@router.post("/{workspace_id}/projects", response_model=ProjectOut, status_code=201)
async def create_project(workspace_id: UUID, body: ProjectCreate, db: AsyncSession = Depends(get_db)):
    project = await service.create_project(db, workspace_id, body)
    rows = await service.list_projects(db, workspace_id)
    row = next(row for row in rows if str(row["id"]) == str(project.id))
    return ProjectOut.model_validate(row)


@router.get("/{workspace_id}/projects/{project_ref}", response_model=ProjectOut)
async def get_project(workspace_id: UUID, project_ref: str, db: AsyncSession = Depends(get_db)):
    rows = await service.list_projects(db, workspace_id)
    for row in rows:
        if str(row["id"]) == project_ref or row["slug"] == project_ref:
            return ProjectOut.model_validate(row)
    raise HTTPException(404, "Project not found")


@router.patch("/{workspace_id}/projects/{project_ref}", response_model=ProjectOut)
async def update_project(workspace_id: UUID, project_ref: str, body: ProjectUpdate, db: AsyncSession = Depends(get_db)):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    project = await service.update_project(db, workspace_id, project.id, body)
    if project is None:
        raise HTTPException(404, "Project not found")
    rows = await service.list_projects(db, workspace_id)
    row = next(row for row in rows if str(row["id"]) == str(project.id))
    return ProjectOut.model_validate(row)


@router.get("/{workspace_id}/projects/{project_ref}/dashboard", response_model=ProjectDashboardOut)
async def get_project_dashboard(workspace_id: UUID, project_ref: str, db: AsyncSession = Depends(get_db)):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    dashboard = await service.get_project_dashboard(db, workspace_id, project.id)
    if dashboard is None:
        raise HTTPException(404, "Project not found")
    return ProjectDashboardOut(
        project=ProjectOut.model_validate(dashboard["project"]),
        objectives=[ObjectiveOut.model_validate(objective) for objective in dashboard["objectives"]],
        recent_runs=dashboard["recent_runs"],
        blocked_objectives=[ObjectiveOut.model_validate(objective) for objective in dashboard["blocked_objectives"]],
        latest_status_update=ProjectStatusUpdateOut.model_validate(dashboard["latest_status_update"])
        if dashboard["latest_status_update"] else None,
    )


@router.get("/{workspace_id}/projects/{project_ref}/channels", response_model=list[ChannelOut])
async def list_project_channels(
    workspace_id: UUID,
    project_ref: str,
    include_archived: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    rows = await service.list_project_channels(db, workspace_id, project.id, include_archived=include_archived)
    return [ChannelOut.model_validate(row) for row in rows]


@router.get("/{workspace_id}/objectives", response_model=list[ObjectiveOut])
async def list_objectives(
    workspace_id: UUID,
    project_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    rows = await service.list_objectives(db, workspace_id, project_id)
    return [ObjectiveOut.model_validate(row) for row in rows]


@router.post("/{workspace_id}/objectives", response_model=ObjectiveOut, status_code=201)
async def create_objective(workspace_id: UUID, body: ObjectiveCreate, db: AsyncSession = Depends(get_db)):
    try:
        objective = await service.create_objective(db, workspace_id, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    row = await service.get_objective(db, workspace_id, objective.id)
    return ObjectiveOut.model_validate(row)


@router.get("/{workspace_id}/objectives/{objective_ref}", response_model=ObjectiveOut)
async def get_objective(workspace_id: UUID, objective_ref: str, db: AsyncSession = Depends(get_db)):
    row = await service.get_objective(db, workspace_id, objective_ref)
    if row is None:
        raise HTTPException(404, "Objective not found")
    return ObjectiveOut.model_validate(row)


@router.patch("/{workspace_id}/objectives/{objective_ref}", response_model=ObjectiveOut)
async def update_objective(workspace_id: UUID, objective_ref: str, body: ObjectiveUpdate, db: AsyncSession = Depends(get_db)):
    try:
        resolved = await service.resolve_objective_ref(db, workspace_id, objective_ref)
        if resolved is None:
            raise HTTPException(404, "Objective not found")
        objective = await service.update_objective(db, workspace_id, resolved.id, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if objective is None:
        raise HTTPException(404, "Objective not found")
    row = await service.get_objective(db, workspace_id, objective.id)
    return ObjectiveOut.model_validate(row)


@router.post("/{workspace_id}/projects/{project_ref}/status-updates", response_model=ProjectStatusUpdateOut, status_code=201)
async def create_project_status_update(
    workspace_id: UUID, project_ref: str, body: ProjectStatusUpdateCreate, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    update = await service.create_project_status_update(db, workspace_id, project.id, body)
    return ProjectStatusUpdateOut.model_validate(update)


@router.get("/{workspace_id}/projects/{project_ref}/documents", response_model=list[ProjectDocumentOut])
async def list_project_documents(workspace_id: UUID, project_ref: str, db: AsyncSession = Depends(get_db)):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    rows = await service.list_project_documents(db, workspace_id, project.id)
    return [ProjectDocumentOut.model_validate(row) for row in rows]


@router.get("/{workspace_id}/projects/{project_ref}/folders", response_model=list[KnowledgeFolderOut])
async def list_project_folders(workspace_id: UUID, project_ref: str, db: AsyncSession = Depends(get_db)):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    rows = await service.list_project_folders(db, workspace_id, project.id)
    return [KnowledgeFolderOut.model_validate(row) for row in rows]


@router.post("/{workspace_id}/projects/{project_ref}/folders", response_model=KnowledgeFolderOut, status_code=201)
async def create_project_folder(
    workspace_id: UUID, project_ref: str, body: CreateFolderRequest, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    path = body.path.strip("/")
    if not path:
        raise HTTPException(400, "Folder path cannot be empty")
    row = await service.create_project_folder(db, workspace_id, project.id, path)
    return KnowledgeFolderOut.model_validate(row)


@router.patch("/{workspace_id}/projects/{project_ref}/folders", status_code=204)
async def rename_project_folder(
    workspace_id: UUID,
    project_ref: str,
    path: str,
    body: RenameFolderRequest,
    db: AsyncSession = Depends(get_db),
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    new_path = body.new_path.strip("/")
    if not new_path:
        raise HTTPException(400, "Folder path cannot be empty")
    if new_path == path:
        return
    await service.rename_project_folder(db, workspace_id, project.id, path, new_path)


@router.delete("/{workspace_id}/projects/{project_ref}/folders", status_code=204)
async def delete_project_folder(
    workspace_id: UUID,
    project_ref: str,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    await service.delete_project_folder(db, workspace_id, project.id, path)


@router.post("/{workspace_id}/projects/{project_ref}/documents", response_model=ProjectDocumentOut, status_code=201)
async def create_project_document(
    workspace_id: UUID, project_ref: str, body: ProjectDocumentCreate, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    try:
        row = await service.create_project_document(db, workspace_id, project.id, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return ProjectDocumentOut.model_validate(row)


@router.get("/{workspace_id}/projects/{project_ref}/documents/file", response_model=ProjectDocumentWithContent)
async def get_project_document(
    workspace_id: UUID, project_ref: str, path: str, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    row = await service.get_project_document(db, workspace_id, project.id, path)
    if row is None:
        raise HTTPException(404, "Project document not found")
    fc = await service.get_project_document_content(workspace_id, project.id, path)
    return ProjectDocumentWithContent(
        **ProjectDocumentOut.model_validate(row).model_dump(),
        content=fc.content,
        version_id=fc.version_id,
    )


@router.put("/{workspace_id}/projects/{project_ref}/documents/file", response_model=ProjectDocumentOut)
async def update_project_document(
    workspace_id: UUID, project_ref: str, path: str, body: ProjectDocumentUpdate, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    try:
        row = await service.update_project_document(db, workspace_id, project.id, path, body)
    except FileNotFoundError:
        raise HTTPException(404, "Project document not found")
    return ProjectDocumentOut.model_validate(row)


@router.get("/{workspace_id}/projects/{project_ref}/documents/history", response_model=list[FileVersionOut])
async def get_project_document_history(
    workspace_id: UUID, project_ref: str, path: str, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    versions = await service.get_project_document_history(workspace_id, project.id, path)
    return [
        FileVersionOut(
            version_id=v.version_id,
            saved_at=v.saved_at,
            saved_by=v.saved_by,
            change_summary=v.change_summary,
        )
        for v in versions
    ]


@router.post("/{workspace_id}/projects/{project_ref}/documents/restore", response_model=ProjectDocumentOut)
async def restore_project_document(
    workspace_id: UUID,
    project_ref: str,
    path: str,
    body: KnowledgeRestoreRequest,
    db: AsyncSession = Depends(get_db),
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    try:
        row = await service.restore_project_document(db, workspace_id, project.id, path, body.version_id, body.restored_by)
    except FileNotFoundError:
        raise HTTPException(404, "Project document not found")
    return ProjectDocumentOut.model_validate(row)


@router.get("/{workspace_id}/projects/{project_ref}/documents/health")
async def get_project_document_health(
    workspace_id: UUID, project_ref: str, path: str, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    try:
        score = await service.get_project_document_health(db, workspace_id, project.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "Project document not found")
    return {"path": path, "health_score": score}


@router.get("/{workspace_id}/projects/{project_ref}/documents/suggestions", response_model=SuggestionOut)
async def get_project_document_suggestions(
    workspace_id: UUID, project_ref: str, path: str, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    try:
        suggestions = await service.get_project_document_suggestions(db, workspace_id, project.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "Project document not found")
    file = await service.get_project_document(db, workspace_id, project.id, path)
    return SuggestionOut(suggestions=suggestions, health_score=file.health_score if file else None)


@router.post("/{workspace_id}/projects/{project_ref}/documents/summarize-diff")
async def summarize_project_document_diff(
    workspace_id: UUID, project_ref: str, path: str, body: ProjectDocumentUpdate, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    try:
        summary = await service.summarize_project_document_diff(db, workspace_id, project.id, path, body.content)
    except FileNotFoundError:
        raise HTTPException(404, "Project document not found")
    return {"summary": summary}


@router.patch("/{workspace_id}/projects/{project_ref}/documents/file/rename", response_model=ProjectDocumentOut)
async def rename_project_document(
    workspace_id: UUID, project_ref: str, path: str, body: ProjectDocumentRename, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    try:
        row = await service.rename_project_document(db, workspace_id, project.id, path, body)
    except FileNotFoundError:
        raise HTTPException(404, "Project document not found")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return ProjectDocumentOut.model_validate(row)


@router.delete("/{workspace_id}/projects/{project_ref}/documents/file", status_code=204)
async def delete_project_document(
    workspace_id: UUID, project_ref: str, path: str, db: AsyncSession = Depends(get_db)
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")
    try:
        await service.delete_project_document(db, workspace_id, project.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "Project document not found")


@router.post("/{workspace_id}/projects/{project_ref}/upload")
async def upload_project_file_preview(
    workspace_id: UUID,
    project_ref: str,
    file: UploadFile = File(...),
    folder: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
):
    project = await service.resolve_project_ref(db, workspace_id, project_ref)
    if project is None:
        raise HTTPException(404, "Project not found")

    from knotwork.knowledge.conversion import VIDEO_EXTS, suggested_path
    from knotwork.knowledge.conversion_vision import convert_with_vision

    max_bytes = 10 * 1024 * 1024
    content = await file.read()
    if len(content) > max_bytes:
        raise HTTPException(400, "File is too large (max 10 MB)")

    filename = file.filename or "upload.txt"
    suffix = _Path(filename).suffix.lower()
    if suffix in VIDEO_EXTS:
        raise HTTPException(400, {
            "error": "video_not_supported",
            "message": "Video files aren't supported yet — we're working on it!",
        })

    try:
        markdown, fmt = await convert_with_vision(filename, content)
    except (ValueError, Exception) as exc:
        raise HTTPException(422, f"Conversion failed: {exc}")

    path = suggested_path(filename, folder)
    title = _Path(filename).stem.replace("-", " ").replace("_", " ").title()
    return {
        "suggested_path": path,
        "suggested_title": title,
        "converted_content": markdown,
        "format": fmt,
        "original_filename": filename,
        "raw_bytes_b64": None,
    }

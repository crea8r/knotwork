from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.projects import service
from knotwork.projects.schemas import (
    ProjectCreate,
    ProjectDashboardOut,
    ProjectDocumentCreate,
    ProjectDocumentOut,
    ProjectDocumentUpdate,
    ProjectDocumentWithContent,
    ProjectOut,
    ProjectStatusUpdateCreate,
    ProjectStatusUpdateOut,
    ProjectUpdate,
    TaskCreate,
    TaskOut,
    TaskUpdate,
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


@router.get("/{workspace_id}/projects/{project_id}", response_model=ProjectOut)
async def get_project(workspace_id: UUID, project_id: UUID, db: AsyncSession = Depends(get_db)):
    rows = await service.list_projects(db, workspace_id)
    for row in rows:
        if str(row["id"]) == str(project_id):
            return ProjectOut.model_validate(row)
    raise HTTPException(404, "Project not found")


@router.patch("/{workspace_id}/projects/{project_id}", response_model=ProjectOut)
async def update_project(workspace_id: UUID, project_id: UUID, body: ProjectUpdate, db: AsyncSession = Depends(get_db)):
    project = await service.update_project(db, workspace_id, project_id, body)
    if project is None:
        raise HTTPException(404, "Project not found")
    rows = await service.list_projects(db, workspace_id)
    row = next(row for row in rows if str(row["id"]) == str(project.id))
    return ProjectOut.model_validate(row)


@router.get("/{workspace_id}/projects/{project_id}/dashboard", response_model=ProjectDashboardOut)
async def get_project_dashboard(workspace_id: UUID, project_id: UUID, db: AsyncSession = Depends(get_db)):
    dashboard = await service.get_project_dashboard(db, workspace_id, project_id)
    if dashboard is None:
        raise HTTPException(404, "Project not found")
    return ProjectDashboardOut(
        project=ProjectOut.model_validate(dashboard["project"]),
        tasks=[TaskOut.model_validate(task) for task in dashboard["tasks"]],
        recent_runs=dashboard["recent_runs"],
        blocked_tasks=[TaskOut.model_validate(task) for task in dashboard["blocked_tasks"]],
        latest_status_update=ProjectStatusUpdateOut.model_validate(dashboard["latest_status_update"])
        if dashboard["latest_status_update"] else None,
    )


@router.get("/{workspace_id}/tasks", response_model=list[TaskOut])
async def list_tasks(
    workspace_id: UUID,
    project_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    rows = await service.list_tasks(db, workspace_id, project_id)
    return [TaskOut.model_validate(row) for row in rows]


@router.post("/{workspace_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task(workspace_id: UUID, body: TaskCreate, db: AsyncSession = Depends(get_db)):
    try:
        task = await service.create_task(db, workspace_id, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    row = await service.get_task(db, workspace_id, task.id)
    return TaskOut.model_validate(row)


@router.get("/{workspace_id}/tasks/{task_id}", response_model=TaskOut)
async def get_task(workspace_id: UUID, task_id: UUID, db: AsyncSession = Depends(get_db)):
    row = await service.get_task(db, workspace_id, task_id)
    if row is None:
        raise HTTPException(404, "Task not found")
    return TaskOut.model_validate(row)


@router.patch("/{workspace_id}/tasks/{task_id}", response_model=TaskOut)
async def update_task(workspace_id: UUID, task_id: UUID, body: TaskUpdate, db: AsyncSession = Depends(get_db)):
    try:
        task = await service.update_task(db, workspace_id, task_id, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if task is None:
        raise HTTPException(404, "Task not found")
    row = await service.get_task(db, workspace_id, task_id)
    return TaskOut.model_validate(row)


@router.post("/{workspace_id}/projects/{project_id}/status-updates", response_model=ProjectStatusUpdateOut, status_code=201)
async def create_project_status_update(
    workspace_id: UUID, project_id: UUID, body: ProjectStatusUpdateCreate, db: AsyncSession = Depends(get_db)
):
    project = await service.get_project(db, workspace_id, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    update = await service.create_project_status_update(db, workspace_id, project_id, body)
    return ProjectStatusUpdateOut.model_validate(update)


@router.get("/{workspace_id}/projects/{project_id}/documents", response_model=list[ProjectDocumentOut])
async def list_project_documents(workspace_id: UUID, project_id: UUID, db: AsyncSession = Depends(get_db)):
    project = await service.get_project(db, workspace_id, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    rows = await service.list_project_documents(db, workspace_id, project_id)
    return [ProjectDocumentOut.model_validate(row) for row in rows]


@router.post("/{workspace_id}/projects/{project_id}/documents", response_model=ProjectDocumentOut, status_code=201)
async def create_project_document(
    workspace_id: UUID, project_id: UUID, body: ProjectDocumentCreate, db: AsyncSession = Depends(get_db)
):
    project = await service.get_project(db, workspace_id, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    try:
        row = await service.create_project_document(db, workspace_id, project_id, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return ProjectDocumentOut.model_validate(row)


@router.get("/{workspace_id}/projects/{project_id}/documents/file", response_model=ProjectDocumentWithContent)
async def get_project_document(
    workspace_id: UUID, project_id: UUID, path: str, db: AsyncSession = Depends(get_db)
):
    row = await service.get_project_document(db, workspace_id, project_id, path)
    if row is None:
        raise HTTPException(404, "Project document not found")
    fc = await service.get_project_document_content(workspace_id, project_id, path)
    return ProjectDocumentWithContent(
        **ProjectDocumentOut.model_validate(row).model_dump(),
        content=fc.content,
        version_id=fc.version_id,
    )


@router.put("/{workspace_id}/projects/{project_id}/documents/file", response_model=ProjectDocumentOut)
async def update_project_document(
    workspace_id: UUID, project_id: UUID, path: str, body: ProjectDocumentUpdate, db: AsyncSession = Depends(get_db)
):
    try:
        row = await service.update_project_document(db, workspace_id, project_id, path, body)
    except FileNotFoundError:
        raise HTTPException(404, "Project document not found")
    return ProjectDocumentOut.model_validate(row)

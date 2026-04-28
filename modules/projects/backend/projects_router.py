from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db
from modules.communication.backend.channels_schemas import ChannelOut

from . import projects_service as service
from .projects_schemas import (
    ObjectiveCreate,
    ObjectiveOut,
    ObjectiveUpdate,
    ProjectCreate,
    ProjectDashboardOut,
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

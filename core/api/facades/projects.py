"""Core facade for project APIs used across modules."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from modules.projects.backend import projects_service
from modules.projects.backend.projects_models import Objective, Project


async def resolve_project_ref(db: AsyncSession, workspace_id: UUID, project_ref: str):
    return await projects_service.resolve_project_ref(db, workspace_id, project_ref)


async def render_project_context(db: AsyncSession, workspace_id: UUID, project_id: UUID | None) -> str:
    return await projects_service.render_project_context(db, workspace_id, project_id)


async def get_project(db: AsyncSession, project_id: UUID):
    return await db.get(Project, project_id)


async def get_objective(db: AsyncSession, objective_id: UUID):
    return await db.get(Objective, objective_id)

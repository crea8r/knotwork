from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    title: str
    description: str
    status: str = "open"
    deadline: date | None = None


class ProjectUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    deadline: date | None = None


class ProjectStatusUpdateCreate(BaseModel):
    summary: str
    author_type: str = "human"
    author_name: str | None = None


class ObjectiveCreate(BaseModel):
    code: str | None = None
    title: str
    description: str | None = None
    status: str = "open"
    progress_percent: int = 0
    status_summary: str | None = None
    key_results: list[str] = Field(default_factory=list)
    owner_type: str | None = None
    owner_name: str | None = None
    deadline: date | None = None
    project_id: UUID | None = None
    parent_objective_id: UUID | None = None
    origin_type: str = "manual"
    origin_graph_id: UUID | None = None


class ObjectiveUpdate(BaseModel):
    code: str | None = None
    title: str | None = None
    description: str | None = None
    status: str | None = None
    progress_percent: int | None = None
    status_summary: str | None = None
    key_results: list[str] | None = None
    owner_type: str | None = None
    owner_name: str | None = None
    deadline: date | None = None
    project_id: UUID | None = None
    parent_objective_id: UUID | None = None


class ProjectDocumentCreate(BaseModel):
    path: str
    title: str | None = None
    content: str
    file_type: str = "md"
    change_summary: str | None = None


class ProjectDocumentUpdate(BaseModel):
    content: str
    change_summary: str | None = None


class ProjectDocumentRename(BaseModel):
    new_path: str


class ProjectDocumentOut(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID | None = None
    path: str
    title: str
    owner_id: UUID | None = None
    raw_token_count: int
    resolved_token_count: int
    linked_paths: list[str]
    current_version_id: str | None = None
    health_score: float | None = None
    file_type: str
    is_editable: bool
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectDocumentWithContent(ProjectDocumentOut):
    content: str
    version_id: str


class ProjectStatusUpdateOut(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID
    author_type: str
    author_name: str | None = None
    summary: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ObjectiveOut(BaseModel):
    id: UUID
    workspace_id: UUID
    slug: str
    project_id: UUID | None = None
    project_slug: str | None = None
    parent_objective_id: UUID | None = None
    code: str | None = None
    title: str
    description: str | None = None
    status: str
    progress_percent: int
    status_summary: str | None = None
    key_results: list[str] = Field(default_factory=list)
    owner_type: str | None = None
    owner_name: str | None = None
    deadline: date | None = None
    origin_type: str
    origin_graph_id: UUID | None = None
    channel_id: UUID | None = None
    run_count: int = 0
    latest_run_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectOut(BaseModel):
    id: UUID
    workspace_id: UUID
    slug: str
    title: str
    description: str
    status: str
    deadline: date | None = None
    project_channel_id: UUID | None = None
    objective_count: int = 0
    open_objective_count: int = 0
    run_count: int = 0
    latest_status_update: ProjectStatusUpdateOut | None = None
    latest_activity_at: datetime
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectDashboardOut(BaseModel):
    project: ProjectOut
    objectives: list[ObjectiveOut]
    recent_runs: list[dict]
    blocked_objectives: list[ObjectiveOut]
    latest_status_update: ProjectStatusUpdateOut | None = None

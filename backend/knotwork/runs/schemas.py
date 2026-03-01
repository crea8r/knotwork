from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class RunCreate(BaseModel):
    name: str | None = None
    input: dict = {}
    context_files: list[dict] = []
    trigger: str = "manual"


class RunUpdate(BaseModel):
    name: str | None = None
    input: dict | None = None


class RunNodeStateOut(BaseModel):
    id: UUID
    run_id: UUID
    node_id: str
    status: str
    input: dict | None
    output: dict | None
    knowledge_snapshot: dict | None
    resolved_token_count: int | None
    confidence_score: float | None
    retry_count: int
    error: str | None
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class RunOut(BaseModel):
    id: UUID
    workspace_id: UUID
    graph_id: UUID
    graph_version_id: UUID
    name: str | None = None
    status: str
    trigger: str
    input: dict
    context_files: list
    output: dict | None
    eta_seconds: int | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    # Enriched fields — populated by list/detail endpoints
    total_tokens: int | None = None
    output_summary: str | None = None
    needs_attention: bool = False

    model_config = {"from_attributes": True}


class ResumeRun(BaseModel):
    """Payload when a human resolves an escalation and resumes the run."""
    resolution: str  # approved | edited | guided | aborted
    edited_output: str | None = None
    guidance: str | None = None

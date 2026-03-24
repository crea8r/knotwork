from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class RunAttachmentRef(BaseModel):
    key: str
    url: str
    filename: str
    mime_type: str
    size: int
    attachment_id: str


class RunAttachmentUploadOut(BaseModel):
    key: str
    url: str
    filename: str
    mime_type: str
    size: int
    attachment_id: str


class RunCreate(BaseModel):
    name: str | None = None
    input: dict = {}
    context_files: list[dict] = []
    trigger: str = "manual"
    graph_version_id: UUID | None = None


class RunUpdate(BaseModel):
    name: str | None = None
    input: dict | None = None


class RunNodeStateOut(BaseModel):
    id: UUID
    run_id: str
    node_id: str
    node_name: str | None = None
    agent_ref: str | None = None
    status: str
    input: dict | None
    output: dict | None
    agent_logs: list = []
    next_branch: str | None = None
    knowledge_snapshot: dict | None
    resolved_token_count: int | None
    confidence_score: float | None
    retry_count: int
    error: str | None
    started_at: datetime | None
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class RunWorklogEntryOut(BaseModel):
    id: UUID
    run_id: str
    node_id: str
    agent_ref: str | None = None
    entry_type: str
    content: str
    metadata_: dict = {}
    created_at: datetime

    model_config = {"from_attributes": True}


class RunHandbookProposalOut(BaseModel):
    id: UUID
    run_id: str
    node_id: str
    agent_ref: str | None = None
    path: str
    proposed_content: str
    reason: str
    status: str
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None
    final_content: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class OpenAICallLogOut(BaseModel):
    id: UUID
    workspace_id: UUID
    workflow_id: UUID | None = None
    run_id: str
    run_node_state_id: UUID | None = None
    node_id: str
    agent_ref: str | None = None
    provider: str
    openai_assistant_id: str | None = None
    openai_thread_id: str | None = None
    openai_run_id: str | None = None
    request_payload: dict = {}
    response_payload: dict | None = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RunOut(BaseModel):
    id: str
    workspace_id: UUID
    graph_id: UUID
    graph_version_id: UUID | None = None
    # Draft run metadata — non-null when run was executed against a draft
    draft_snapshot_at: datetime | None = None
    draft_parent_version_id: UUID | None = None  # enriched from graph_version_id FK
    name: str | None = None
    status: str
    trigger: str
    input: dict
    context_files: list
    output: dict | None
    eta_seconds: int | None
    error: str | None = None
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
    resolution: str  # accept_output | override_output | request_revision | abort_run
    override_output: dict | None = None
    edited_output: str | None = None  # backward-compatible alias
    guidance: str | None = None

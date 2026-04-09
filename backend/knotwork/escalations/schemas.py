from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class EscalationOut(BaseModel):
    id: UUID
    run_id: str
    run_node_state_id: UUID
    workspace_id: UUID
    type: str
    status: str
    context: dict
    assigned_to: list
    timeout_at: datetime | None
    resolved_by: UUID | None
    resolved_at: datetime | None
    resolution: str | None
    resolution_data: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EscalationResolve(BaseModel):
    resolution: Literal[
        "accept_output",
        "override_output",
        "request_revision",
        "abort_run",
        # Backward-compatible aliases:
        "approved",
        "edited",
        "guided",
        "aborted",
    ]
    override_output: dict | None = None
    edited_output: dict | None = None
    guidance: str | None = None
    answers: list[str] | None = None    # Q&A escalation: indexed answers per question
    next_branch: str | None = None      # routing escalation: human-chosen branch
    channel_id: UUID | None = None
    actor_name: str | None = None
    actor_type: Literal["human", "agent", "system"] | None = None

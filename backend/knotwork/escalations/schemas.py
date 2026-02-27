from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class EscalationOut(BaseModel):
    id: UUID
    run_id: UUID
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
    resolution: Literal["approved", "edited", "guided", "aborted"]
    edited_output: dict | None = None
    guidance: str | None = None

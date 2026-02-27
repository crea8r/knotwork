from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class RatingCreate(BaseModel):
    score: int = Field(..., ge=1, le=5)
    comment: str | None = None
    source: str = "human"


class RatingOut(BaseModel):
    id: UUID
    run_id: UUID
    run_node_state_id: UUID
    workspace_id: UUID
    rated_by: UUID | None
    source: str
    score: int
    comment: str | None
    knowledge_snapshot: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}

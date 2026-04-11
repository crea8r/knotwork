from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ToolCreate(BaseModel):
    name: str
    slug: str
    category: str  # http | function | builtin
    scope: str = "workspace"
    definition: dict = {}


class ToolUpdate(BaseModel):
    name: str | None = None
    definition: dict | None = None


class ToolResponse(BaseModel):
    id: UUID
    workspace_id: UUID | None
    name: str
    slug: str
    category: str
    scope: str
    definition: dict
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}



class ToolTestRequest(BaseModel):
    input: dict


class ToolTestResponse(BaseModel):
    output: dict
    error: str | None = None
    duration_ms: float

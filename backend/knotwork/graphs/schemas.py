from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class NodeDefSchema(BaseModel):
    id: str
    type: str
    name: str
    config: dict = {}
    note: str | None = None
    # Preserve top-level node fields introduced by newer sessions
    # (e.g. agent_ref, trust_level, registered_agent_id) instead of
    # silently dropping them during GraphVersion model validation.
    model_config = {"extra": "allow"}


class EdgeDefSchema(BaseModel):
    id: str
    source: str
    target: str
    type: str = "direct"
    condition_label: str | None = None


class InputFieldDef(BaseModel):
    name: str
    label: str
    description: str = ""
    required: bool = True
    type: Literal["text", "textarea", "number"] = "text"


class GraphDefinitionSchema(BaseModel):
    nodes: list[NodeDefSchema] = []
    edges: list[EdgeDefSchema] = []
    entry_point: str | None = None
    input_schema: list[InputFieldDef] = []


class GraphUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    default_model: str | None = None


class DesignChatRequest(BaseModel):
    session_id: str
    message: str
    graph_id: str


class DesignChatResponse(BaseModel):
    reply: str
    graph_delta: dict
    questions: list[str]


class ImportMdRequest(BaseModel):
    content: str
    name: str


class GraphCreate(BaseModel):
    name: str
    description: str | None = None
    default_model: str | None = None
    definition: GraphDefinitionSchema = GraphDefinitionSchema()


class GraphVersionCreate(BaseModel):
    definition: GraphDefinitionSchema
    note: str | None = None


class GraphVersionOut(BaseModel):
    id: UUID
    graph_id: UUID
    definition: dict
    note: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class GraphOut(BaseModel):
    id: UUID
    workspace_id: UUID
    name: str
    description: str | None
    status: str
    default_model: str | None
    run_count: int = 0
    latest_version: GraphVersionOut | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class GraphDeleteResult(BaseModel):
    action: Literal["deleted", "archived"]
    run_count: int

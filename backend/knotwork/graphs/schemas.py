from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class NodeDefSchema(BaseModel):
    id: str
    type: str
    name: str
    config: dict = {}
    note: str | None = None


class EdgeDefSchema(BaseModel):
    id: str
    source: str
    target: str
    type: str = "direct"
    condition_label: str | None = None


class GraphDefinitionSchema(BaseModel):
    nodes: list[NodeDefSchema] = []
    edges: list[EdgeDefSchema] = []
    entry_point: str | None = None


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
    latest_version: GraphVersionOut | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

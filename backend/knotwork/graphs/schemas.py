from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, field_validator, model_validator


LEGACY_NODE_TYPE_MAP = {
    "llm_agent": "agent",
    "human_checkpoint": "agent",
    "conditional_router": "agent",
    "tool_executor": "agent",
}


def normalize_node_def(node: dict) -> dict:
    if not isinstance(node, dict):
        return node
    normalized = dict(node)
    legacy_type = str(normalized.get("type") or "")
    normalized["type"] = LEGACY_NODE_TYPE_MAP.get(legacy_type, legacy_type)
    if legacy_type == "human_checkpoint" and not normalized.get("agent_ref"):
        normalized["agent_ref"] = "human"
    return normalized


def normalize_graph_definition(definition: dict | None) -> dict:
    payload = dict(definition or {})
    payload["nodes"] = [normalize_node_def(node) for node in payload.get("nodes", [])]
    payload.setdefault("edges", [])
    payload.setdefault("input_schema", [])
    return payload


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

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_type(cls, data):
        return normalize_node_def(data)


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

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_nodes(cls, data):
        return normalize_graph_definition(data)


class GraphUpdate(BaseModel):
    name: str | None = None
    path: str | None = None
    description: str | None = None
    status: str | None = None
    default_model: str | None = None
    project_id: UUID | None = None


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
    path: str = ""
    description: str | None = None
    default_model: str | None = None
    project_id: UUID | None = None
    definition: GraphDefinitionSchema = GraphDefinitionSchema()


class GraphVersionCreate(BaseModel):
    definition: GraphDefinitionSchema
    note: str | None = None


class DraftUpsertRequest(BaseModel):
    """Create or update the draft for a given parent version (or root draft)."""
    definition: GraphDefinitionSchema


class VersionRenameRequest(BaseModel):
    name: str


class ForkRequest(BaseModel):
    name: str  # name of the new workflow


class GraphVersionOut(BaseModel):
    id: UUID
    graph_id: UUID
    definition: dict
    note: str | None
    # Versioning
    version_id: str | None = None
    version_name: str | None = None
    version_created_at: datetime | None = None
    parent_version_id: UUID | None = None
    archived_at: datetime | None = None
    version_slug: str | None = None
    public_description_md: str | None = None
    updated_at: datetime
    created_at: datetime
    # Enriched: attached draft (if any), run count — populated by list endpoints
    draft: GraphVersionOut | None = None
    run_count: int = 0

    model_config = {"from_attributes": True}

    @field_validator("definition", mode="before")
    @classmethod
    def _normalize_definition(cls, value):
        return normalize_graph_definition(value)


# Forward reference needed for self-referential `draft` field
GraphVersionOut.model_rebuild()


class GraphOut(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID | None = None
    name: str
    path: str = ""
    description: str | None
    status: str
    default_model: str | None
    production_version_id: UUID | None = None
    slug: str | None = None
    run_count: int = 0
    latest_version: GraphVersionOut | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class GraphDeleteResult(BaseModel):
    action: Literal["deleted", "archived"]
    run_count: int

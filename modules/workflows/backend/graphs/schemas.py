from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator


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


class WorkflowDefinitionSchema(BaseModel):
    nodes: list[NodeDefSchema] = []
    edges: list[EdgeDefSchema] = []
    entry_point: str | None = None
    input_schema: list[InputFieldDef] = []

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_nodes(cls, data):
        return normalize_graph_definition(data)


class WorkflowUpdate(BaseModel):
    name: str | None = None
    path: str | None = None
    description: str | None = None
    status: str | None = None
    default_model: str | None = None
    project_id: UUID | None = None


class DesignWorkflowChatRequest(BaseModel):
    session_id: str
    message: str
    workflow_id: str = Field(
        alias="graph_id",
        validation_alias=AliasChoices("workflow_id", "graph_id"),
        serialization_alias="workflow_id",
    )

    model_config = ConfigDict(populate_by_name=True)

    @property
    def graph_id(self) -> str:
        return self.workflow_id


class DesignWorkflowChatResponse(BaseModel):
    reply: str
    workflow_delta: dict = Field(
        default_factory=dict,
        validation_alias=AliasChoices("workflow_delta", "graph_delta"),
        serialization_alias="workflow_delta",
    )
    questions: list[str]
    author_name: str | None = None

    model_config = ConfigDict(populate_by_name=True)

    @computed_field(return_type=dict)
    @property
    def graph_delta(self) -> dict:
        return self.workflow_delta


class ImportMdRequest(BaseModel):
    content: str
    name: str


class WorkflowCreate(BaseModel):
    name: str
    path: str = ""
    description: str | None = None
    default_model: str | None = None
    project_id: UUID | None = None
    definition: WorkflowDefinitionSchema = WorkflowDefinitionSchema()


class WorkflowVersionCreate(BaseModel):
    definition: WorkflowDefinitionSchema
    note: str | None = None


class DraftUpsertRequest(BaseModel):
    """Create or update the draft for a given parent version (or root draft)."""
    definition: WorkflowDefinitionSchema


class VersionRenameRequest(BaseModel):
    name: str


class ForkRequest(BaseModel):
    name: str  # name of the new workflow


class WorkflowVersionOut(BaseModel):
    id: UUID
    workflow_id: UUID = Field(
        alias="graph_id",
        validation_alias=AliasChoices("workflow_id", "graph_id"),
        serialization_alias="workflow_id",
    )
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
    draft: WorkflowVersionOut | None = None
    run_count: int = 0

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    @field_validator("definition", mode="before")
    @classmethod
    def _normalize_definition(cls, value):
        return normalize_graph_definition(value)

    @computed_field(return_type=UUID)
    @property
    def graph_id(self) -> UUID:
        return self.workflow_id


# Forward reference needed for self-referential `draft` field
WorkflowVersionOut.model_rebuild()


class WorkflowOut(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID | None = None
    project_slug: str | None = None
    name: str
    path: str = ""
    asset_path: str = ""
    description: str | None
    status: str
    default_model: str | None
    production_version_id: UUID | None = None
    slug: str | None = None
    run_count: int = 0
    latest_version: WorkflowVersionOut | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class WorkflowDeleteResult(BaseModel):
    action: Literal["deleted", "archived"]
    run_count: int


# Backward-compatible internal aliases. Use Workflow* names at public boundaries.
GraphDefinitionSchema = WorkflowDefinitionSchema
GraphUpdate = WorkflowUpdate
DesignChatRequest = DesignWorkflowChatRequest
DesignChatResponse = DesignWorkflowChatResponse
GraphCreate = WorkflowCreate
GraphVersionCreate = WorkflowVersionCreate
GraphVersionOut = WorkflowVersionOut
GraphOut = WorkflowOut
GraphDeleteResult = WorkflowDeleteResult

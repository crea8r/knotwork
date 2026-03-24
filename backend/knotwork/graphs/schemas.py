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
    is_public: bool = False
    updated_at: datetime
    created_at: datetime
    # Enriched: attached draft (if any), run count — populated by list endpoints
    draft: GraphVersionOut | None = None
    run_count: int = 0

    model_config = {"from_attributes": True}


# Forward reference needed for self-referential `draft` field
GraphVersionOut.model_rebuild()


class GraphOut(BaseModel):
    id: UUID
    workspace_id: UUID
    name: str
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

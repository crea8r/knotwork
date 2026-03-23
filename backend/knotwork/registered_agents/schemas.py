"""Pydantic request/response schemas for registered_agents."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


ProviderType = Literal["anthropic", "openai", "openclaw"]
AgentStatusType = Literal["inactive", "active", "archived"]
CapabilityFreshnessType = Literal["fresh", "stale", "needs_refresh"]


class AgentCredentials(BaseModel):
    type: Literal["api_key", "none"] = "api_key"
    api_key: str | None = None


class RegisteredAgentCreate(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=200)
    avatar_url: str | None = Field(default=None, max_length=500)
    provider: ProviderType
    agent_ref: str = Field(..., min_length=1, max_length=200)
    api_key: str | None = None  # backward-compatible request shape
    endpoint: str | None = None
    credentials: AgentCredentials | None = None
    activate_after_preflight: bool = False  # kept for API compat; activates immediately on create


class RegisteredAgentUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    avatar_url: str | None = Field(default=None, max_length=500)
    bio: str | None = Field(default=None, max_length=1000)


class AgentConnectivityUpdate(BaseModel):
    endpoint: str | None = Field(default=None, max_length=500)
    credentials: AgentCredentials | None = None


class RegisteredAgentOut(BaseModel):
    id: UUID
    workspace_id: UUID
    display_name: str
    avatar_url: str | None
    bio: str | None = None
    provider: ProviderType
    agent_ref: str
    api_key_hint: str | None
    endpoint: str | None
    is_active: bool
    status: AgentStatusType
    capability_version: str | None = None
    capability_hash: str | None = None
    capability_refreshed_at: datetime | None = None
    capability_freshness: CapabilityFreshnessType = "needs_refresh"
    last_used_at: datetime | None = None
    openclaw_integration_id: UUID | None = None
    openclaw_remote_agent_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RegisteredAgentHistoryItem(BaseModel):
    run_id: str
    run_name: str | None = None
    run_status: str
    run_created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    graph_id: UUID
    graph_name: str
    involved_nodes: list[str] = []


class CapabilityTool(BaseModel):
    name: str
    description: str = ""
    input_schema: dict[str, Any] = {}
    risk_class: str = "medium"


class CapabilityContractOut(BaseModel):
    agent_id: UUID
    version: str | None = None
    hash: str
    refreshed_at: datetime
    tools: list[CapabilityTool] = []
    constraints: dict[str, Any] = {}
    policy_notes: list[str] = []
    raw: dict[str, Any] = {}


class CapabilitySnapshotOut(CapabilityContractOut):
    id: UUID
    changed_from_previous: bool = False
    source: str = "refresh"


class CapabilityRefreshRequest(BaseModel):
    save_snapshot: bool = True


class CapabilityRefreshOut(BaseModel):
    changed: bool
    capability: CapabilityContractOut


class ActivateAgentRequest(BaseModel):
    pass


class DeactivateAgentRequest(BaseModel):
    reason: str | None = None


class ArchiveAgentRequest(BaseModel):
    reason: str | None = None


class CompatibilityCheckRequest(BaseModel):
    requirements: dict[str, Any] = {}


class CompatibilityWarning(BaseModel):
    code: str
    message: str


class CompatibilityCheckOut(BaseModel):
    compatible: bool
    warnings: list[CompatibilityWarning] = []
    missing_capabilities: list[str] = []


class AgentUsageItem(BaseModel):
    type: Literal["run", "workflow"]
    run_id: str | None = None
    workflow_id: UUID | None = None
    workflow_name: str | None = None
    status: str | None = None
    timestamp: datetime


class DebugLinkItem(BaseModel):
    run_id: str
    node_id: str | None = None
    provider_request_id: str | None = None
    provider_response_id: str | None = None
    provider_trace_id: str | None = None
    created_at: datetime


class ChatAttachmentRef(BaseModel):
    """A file attachment referenced by its storage key. Knotwork stores; OpenClaw fetches."""
    key: str            # storage key, e.g. "chat-attachments/{uuid}/{filename}"
    url: str            # full URL the OpenClaw plugin can GET to download the raw bytes
    filename: str
    mime_type: str
    size: int           # bytes


class AgentMainChatAskRequest(BaseModel):
    message: str = Field(..., min_length=0, max_length=50_000)
    attachments: list[ChatAttachmentRef] = []


class AgentMainChatAskResponse(BaseModel):
    task_id: UUID
    status: Literal["completed", "escalated", "failed", "timeout"]
    reply: str | None = None
    question: str | None = None


class AgentMainChatEnsureResponse(BaseModel):
    ready: bool
    status: Literal["already_ready", "initialized", "initializing", "timeout"]
    task_id: UUID | None = None
    session_name: str
    message: str | None = None

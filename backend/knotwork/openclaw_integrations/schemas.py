from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class HandshakeTokenCreateRequest(BaseModel):
    ttl_minutes: int = Field(default=525600, ge=5, le=525600)


class HandshakeTokenOut(BaseModel):
    workspace_id: UUID
    token: str
    expires_at: datetime


class OpenClawRemoteAgentIn(BaseModel):
    remote_agent_id: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=1, max_length=200)
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    tools: list[dict[str, Any]] = []
    constraints: dict[str, Any] = {}


class PluginHandshakeRequest(BaseModel):
    token: str = Field(..., min_length=8, max_length=200)
    plugin_instance_id: str = Field(..., min_length=1, max_length=200)
    openclaw_workspace_id: str | None = Field(default=None, max_length=200)
    plugin_version: str | None = Field(default=None, max_length=100)
    metadata: dict[str, Any] = {}
    agents: list[OpenClawRemoteAgentIn] = []


class OpenClawIntegrationOut(BaseModel):
    id: UUID
    workspace_id: UUID
    plugin_instance_id: str
    openclaw_workspace_id: str | None
    plugin_version: str | None
    status: str
    connected_at: datetime
    last_seen_at: datetime
    created_at: datetime
    updated_at: datetime


class OpenClawRemoteAgentOut(BaseModel):
    id: UUID
    workspace_id: UUID
    integration_id: UUID
    remote_agent_id: str
    slug: str
    display_name: str
    description: str | None = None
    tools: list[dict[str, Any]] = []
    constraints: dict[str, Any] = {}
    is_active: bool
    last_synced_at: datetime


class PluginHandshakeResponse(BaseModel):
    integration_id: UUID
    workspace_id: UUID
    accepted: bool
    synced_agents: int
    integration_secret: str | None = None


class RegisterFromOpenClawRequest(BaseModel):
    integration_id: UUID
    remote_agent_id: str
    display_name: str | None = None


class RegisterFromOpenClawResponse(BaseModel):
    registered_agent_id: UUID
    display_name: str
    agent_ref: str
    provider: str = "openclaw"


class PluginPullTaskRequest(BaseModel):
    plugin_instance_id: str = Field(..., min_length=1, max_length=200)


class PluginTaskEventRequest(BaseModel):
    plugin_instance_id: str = Field(..., min_length=1, max_length=200)
    event_type: str = Field(..., min_length=1, max_length=80)
    payload: dict[str, Any] = {}


class OpenClawTaskDebugItem(BaseModel):
    task_id: UUID
    integration_id: UUID
    status: str
    node_id: str
    run_id: UUID | None = None
    agent_ref: str
    created_at: datetime
    claimed_at: datetime | None = None
    completed_at: datetime | None = None
    failed_at: datetime | None = None
    updated_at: datetime
    error_message: str | None = None
    event_count: int = 0
    latest_event_at: datetime | None = None


class OpenClawIntegrationDebugState(BaseModel):
    integration_id: UUID
    plugin_instance_id: str
    status: str
    connected_at: datetime
    last_seen_at: datetime
    pending_count: int = 0
    claimed_count: int = 0
    completed_count: int = 0
    failed_count: int = 0
    escalated_count: int = 0
    latest_task_created_at: datetime | None = None
    oldest_pending_task_at: datetime | None = None


class OpenClawDebugStateOut(BaseModel):
    workspace_id: UUID
    now_utc: datetime
    integrations: list[OpenClawIntegrationDebugState] = []
    recent_tasks: list[OpenClawTaskDebugItem] = []

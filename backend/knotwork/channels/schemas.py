from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class ChannelOut(BaseModel):
    id: UUID
    workspace_id: UUID
    name: str
    channel_type: str
    graph_id: UUID | None = None
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChannelCreate(BaseModel):
    name: str
    channel_type: Literal["normal", "workflow", "handbook"] = "normal"
    graph_id: UUID | None = None


class ChannelMessageOut(BaseModel):
    id: UUID
    workspace_id: UUID
    channel_id: UUID
    run_id: str | None = None
    node_id: str | None = None
    role: str
    author_type: str
    author_name: str | None = None
    content: str
    metadata_: dict = {}
    created_at: datetime

    model_config = {"from_attributes": True}


class ChannelMessageCreate(BaseModel):
    role: Literal["user", "assistant", "system"] = "user"
    author_type: Literal["human", "agent", "system"] = "human"
    author_name: str | None = None
    content: str
    run_id: str | None = None
    node_id: str | None = None
    metadata: dict = {}


class DecisionEventOut(BaseModel):
    id: UUID
    workspace_id: UUID
    channel_id: UUID | None = None
    run_id: str | None = None
    escalation_id: UUID | None = None
    decision_type: str
    actor_type: str
    actor_name: str | None = None
    payload: dict = {}
    created_at: datetime

    model_config = {"from_attributes": True}


class DecisionEventCreate(BaseModel):
    decision_type: str
    actor_type: Literal["human", "agent", "system"] = "human"
    actor_name: str | None = None
    run_id: str | None = None
    escalation_id: UUID | None = None
    payload: dict = {}


class InboxItem(BaseModel):
    id: str
    item_type: Literal["escalation", "handbook_proposal"]
    title: str
    subtitle: str | None = None
    status: str
    run_id: str | None = None
    escalation_id: UUID | None = None
    proposal_id: UUID | None = None
    due_at: datetime | None = None
    created_at: datetime


class HandbookChatAskRequest(BaseModel):
    message: str


class HandbookChatAskResponse(BaseModel):
    reply: str
    proposal_id: str | None = None


class HandbookProposalResolveRequest(BaseModel):
    resolution: Literal["accept_output", "override_output", "abort_run"]
    final_content: str | None = None

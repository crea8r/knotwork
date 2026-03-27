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
    project_id: UUID | None = None
    task_id: UUID | None = None
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChannelCreate(BaseModel):
    name: str
    channel_type: Literal["normal", "workflow", "handbook", "run", "agent_main", "project", "task"] = "normal"
    graph_id: UUID | None = None
    project_id: UUID | None = None
    task_id: UUID | None = None


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
    item_type: Literal["escalation", "handbook_proposal", "mentioned_message", "task_assigned", "run_event"]
    delivery_id: str | None = None
    title: str
    subtitle: str | None = None
    status: str
    run_id: str | None = None
    channel_id: str | None = None
    escalation_id: UUID | None = None
    proposal_id: UUID | None = None
    due_at: datetime | None = None
    created_at: datetime
    unread: bool = False
    archived_at: datetime | None = None


class InboxSummary(BaseModel):
    unread_count: int
    active_count: int
    archived_count: int


class InboxStateUpdate(BaseModel):
    archived: bool | None = None
    read: bool | None = None


class ParticipantDeliveryPreferenceOut(BaseModel):
    participant_id: str
    event_type: str
    app_enabled: bool
    email_enabled: bool
    plugin_enabled: bool
    email_address: str | None = None

    model_config = {"from_attributes": True}


class ParticipantDeliveryPreferenceUpdate(BaseModel):
    app_enabled: bool | None = None
    email_enabled: bool | None = None
    plugin_enabled: bool | None = None
    email_address: str | None = None


class ParticipantDeliveryPreferenceBundle(BaseModel):
    participant_id: str
    kind: Literal["human", "agent"]
    display_name: str
    event_types: list[ParticipantDeliveryPreferenceOut]

    model_config = {"from_attributes": True}


class ChannelSubscriptionOut(BaseModel):
    channel_id: UUID
    participant_id: str
    subscribed: bool
    subscribed_at: datetime | None = None
    unsubscribed_at: datetime | None = None


class ChannelSubscriptionUpdate(BaseModel):
    subscribed: bool


class ChannelAssetBindingOut(BaseModel):
    id: str
    channel_id: UUID
    asset_type: Literal["workflow", "run", "file"]
    asset_id: str
    display_name: str
    path: str | None = None
    status: str | None = None
    created_at: datetime


class ChannelAssetBindingCreate(BaseModel):
    asset_type: Literal["workflow", "run", "file"]
    asset_id: str


class HandbookChatAskRequest(BaseModel):
    message: str


class HandbookChatAskResponse(BaseModel):
    reply: str
    proposal_id: str | None = None


class HandbookProposalResolveRequest(BaseModel):
    resolution: Literal["accept_output", "override_output", "abort_run"]
    final_content: str | None = None


class ParticipantMentionOption(BaseModel):
    participant_id: str
    display_name: str
    mention_handle: str | None = None
    kind: Literal["human", "agent"]
    email: str | None = None

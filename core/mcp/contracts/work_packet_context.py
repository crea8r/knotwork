from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import channels as core_channels
from core.api import graphs as core_graphs
from libs.auth.backend.models import User
from libs.participants import member_participant_id
from modules.admin.backend.workspaces_models import Workspace, WorkspaceMember
from modules.communication.backend import channels_service
from modules.communication.backend.channels_models import ChannelMessage
from modules.projects.backend.projects_models import Objective
from modules.workflows.backend.runs import service as runs_service
from modules.workflows.backend.runs.escalations_models import Escalation


def isoformat_or_none(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def first_non_empty(*values: str | None) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def serialize_message(message: ChannelMessage) -> dict[str, Any]:
    return {
        "id": str(message.id),
        "created_at": isoformat_or_none(message.created_at),
        "role": message.role,
        "author_type": message.author_type,
        "author_name": message.author_name,
        "content": message.content,
        "metadata": message.metadata_ or {},
    }


def serialize_participant(participant: dict[str, Any]) -> dict[str, Any]:
    return {
        "participant_id": str(participant["participant_id"]),
        "display_name": participant.get("display_name"),
        "kind": participant.get("kind"),
        "mention_handle": participant.get("mention_handle"),
        "contribution_brief": participant.get("contribution_brief"),
        "availability_status": participant.get("availability_status") or "available",
        "capacity_level": participant.get("capacity_level") or "open",
        "subscribed": participant.get("subscribed", True),
    }


def find_trigger_message(
    *,
    message_id: str | None,
    subtitle: str | None,
    messages: list[ChannelMessage],
) -> ChannelMessage | None:
    if message_id:
        for message in messages:
            if str(message.id) == message_id:
                return message
    preview = (subtitle or "").strip()
    if preview:
        for message in reversed(messages):
            if message.content.startswith(preview):
                return message
    return messages[-1] if messages else None


async def _build_objective_chain(db: AsyncSession, workspace_id: UUID, objective_id: UUID | None) -> list[dict[str, Any]]:
    if objective_id is None:
        return []
    chain: list[Objective] = []
    seen: set[UUID] = set()
    current_id: UUID | None = objective_id
    while current_id is not None and current_id not in seen:
        seen.add(current_id)
        objective = await db.get(Objective, current_id)
        if objective is None or objective.workspace_id != workspace_id:
            break
        chain.append(objective)
        current_id = objective.parent_objective_id
    chain.reverse()
    return [
        {
            "id": str(objective.id),
            "title": objective.title,
            "code": objective.code,
            "status": objective.status,
            "progress_percent": objective.progress_percent,
            "status_summary": objective.status_summary,
        }
        for objective in chain
    ]


def _primary_asset(assets: list[dict[str, Any]], trigger: dict[str, Any]) -> dict[str, Any] | None:
    trigger_asset_id = first_non_empty(
        str(trigger.get("asset_id")) if trigger.get("asset_id") is not None else None,
        str(trigger.get("proposal_id")) if trigger.get("proposal_id") is not None and trigger.get("asset_type") == "file" else None,
    )
    trigger_asset_type = first_non_empty(str(trigger.get("asset_type")) if trigger.get("asset_type") is not None else None)
    if trigger_asset_type and trigger_asset_id:
        for asset in assets:
            if str(asset.get("asset_type")) == trigger_asset_type and str(asset.get("asset_id")) == trigger_asset_id:
                return asset
    if trigger_asset_type:
        for asset in assets:
            if str(asset.get("asset_type")) == trigger_asset_type:
                return asset
    return assets[0] if assets else None


@dataclass(slots=True)
class LoadedWorkPacketContext:
    workspace: Workspace
    current_user: User
    member: WorkspaceMember
    task_id: str
    trigger: dict[str, Any]
    session_name: str | None
    legacy_user_prompt: str | None
    self_participant_id: str
    channel: Any | None
    channel_messages: list[ChannelMessage]
    participants: list[dict[str, Any]]
    assets: list[dict[str, Any]]
    trigger_message: ChannelMessage | None
    run: Any | None
    escalation: Escalation | None
    graph: Any | None
    root_draft: Any | None
    objective_chain: list[dict[str, Any]]
    primary_asset: dict[str, Any] | None


async def load_work_packet_context(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    current_user: User,
    member: WorkspaceMember,
    task_id: str,
    trigger: dict[str, Any],
    session_name: str | None = None,
    legacy_user_prompt: str | None = None,
) -> LoadedWorkPacketContext:
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise ValueError("Workspace not found")

    self_participant_id = member_participant_id(member, current_user.id)
    channel_id_value = trigger.get("channel_id")
    channel = await core_channels.get_channel(db, workspace_id, channel_id_value) if channel_id_value else None

    channel_messages: list[ChannelMessage] = []
    participants: list[dict[str, Any]] = []
    assets: list[dict[str, Any]] = []
    if channel is not None:
        channel_messages = await channels_service.list_messages(db, workspace_id, channel.id)
        participants = await channels_service.list_channel_participants(db, workspace_id, channel.id)
        assets = await channels_service.list_channel_asset_bindings(db, workspace_id, channel.id)

    trigger_message = find_trigger_message(
        message_id=str(trigger.get("message_id") or "") or None,
        subtitle=trigger.get("subtitle"),
        messages=channel_messages,
    )
    run_id = trigger.get("run_id")
    run = await runs_service.get_run(db, run_id) if run_id else None
    escalation = await db.get(Escalation, trigger["escalation_id"]) if trigger.get("escalation_id") else None
    graph = await core_graphs.get_graph(db, channel.graph_id) if channel and channel.graph_id else None
    root_draft = await core_graphs.get_any_draft(db, channel.graph_id) if channel and channel.graph_id else None
    objective_chain = await _build_objective_chain(db, workspace_id, channel.objective_id if channel else None)

    return LoadedWorkPacketContext(
        workspace=workspace,
        current_user=current_user,
        member=member,
        task_id=task_id,
        trigger=trigger,
        session_name=session_name,
        legacy_user_prompt=legacy_user_prompt,
        self_participant_id=self_participant_id,
        channel=channel,
        channel_messages=channel_messages,
        participants=participants,
        assets=assets,
        trigger_message=trigger_message,
        run=run,
        escalation=escalation,
        graph=graph,
        root_draft=root_draft,
        objective_chain=objective_chain,
        primary_asset=_primary_asset(assets, trigger),
    )

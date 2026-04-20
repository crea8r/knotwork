from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from libs.participants import resolve_mentioned_participants

from ..channels_models import Channel, ChannelMessage, DecisionEvent
from ..channels_schemas import ChannelMessageCreate, DecisionEventCreate
from .events import publish_channel_event, publish_event_to_channel_subscribers
from .participant_views import set_channel_subscription


TELEMETRY_MESSAGE_KINDS = {
    "run_start",
    "agent_progress",
    "channel_run_started",
    "objective_run_started",
    "workflow_run_created",
}


def _is_telemetry_message_kind(kind: str | None) -> bool:
    return str(kind or "").strip() in TELEMETRY_MESSAGE_KINDS


def _assigned_participant_ids(metadata: dict | None) -> list[str]:
    if not isinstance(metadata, dict):
        return []
    raw: list[str] = []
    top_level = metadata.get("assigned_to")
    if isinstance(top_level, list):
        raw.extend(str(item).strip() for item in top_level if str(item).strip())
    request = metadata.get("request")
    if isinstance(request, dict) and isinstance(request.get("assigned_to"), list):
        raw.extend(str(item).strip() for item in request["assigned_to"] if str(item).strip())
    out: list[str] = []
    seen: set[str] = set()
    for participant_id in raw:
        if participant_id not in seen:
            seen.add(participant_id)
            out.append(participant_id)
    return out


async def list_messages(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> list[ChannelMessage]:
    result = await db.execute(
        select(ChannelMessage)
        .where(ChannelMessage.workspace_id == workspace_id, ChannelMessage.channel_id == channel_id)
        .order_by(ChannelMessage.created_at.asc())
    )
    return list(result.scalars())


async def create_message(db: AsyncSession, workspace_id: UUID, channel_id: UUID, data: ChannelMessageCreate) -> ChannelMessage:
    channel = await db.get(Channel, channel_id)
    if not channel or channel.workspace_id != workspace_id:
        raise ValueError("Channel not found")
    channel.updated_at = datetime.now(timezone.utc)

    metadata = dict(data.metadata or {})
    author_participant_id = metadata.get("author_participant_id")
    mentioned = await resolve_mentioned_participants(db, workspace_id, data.content)
    mentioned_ids = [participant["participant_id"] for participant in mentioned if participant["participant_id"] != author_participant_id]
    if mentioned_ids:
        metadata["mentioned_participant_ids"] = mentioned_ids
        for participant_id in mentioned_ids:
            await set_channel_subscription(db, workspace_id, channel_id, participant_id, subscribed=True)

    message = ChannelMessage(
        workspace_id=workspace_id,
        channel_id=channel_id,
        role=data.role,
        author_type=data.author_type,
        author_name=data.author_name,
        content=data.content,
        run_id=data.run_id,
        node_id=data.node_id,
        metadata_=metadata,
    )
    db.add(message)
    await db.flush()

    await _publish_message_events(db, workspace_id, channel, message, data, metadata, mentioned_ids)
    await db.refresh(message)
    return message


async def _publish_message_events(
    db: AsyncSession,
    workspace_id: UUID,
    channel: Channel,
    message: ChannelMessage,
    data: ChannelMessageCreate,
    metadata: dict,
    mentioned_ids: list[str],
) -> None:
    if not _is_telemetry_message_kind(metadata.get("kind")):
        assigned_to = _assigned_participant_ids(metadata)
        actor_participant_id = metadata.get("author_participant_id")
        payload = {
            "message_id": str(message.id),
            "channel_name": channel.name,
            "message_preview": data.content[:160],
        }
        if assigned_to:
            recipient_ids = [participant_id for participant_id in assigned_to if participant_id != actor_participant_id]
            payload.update(
                {
                    "assigned_to": recipient_ids,
                    "run_id": data.run_id,
                    "title": f"Task assigned in {channel.name}",
                    "subtitle": data.content[:200],
                }
            )
            await publish_channel_event(
                db,
                workspace_id=workspace_id,
                channel_id=channel.id,
                event_type="task_assigned",
                source_type="message",
                source_id=str(message.id),
                actor_type=data.author_type,
                actor_id=actor_participant_id,
                actor_name=data.author_name,
                payload=payload,
                recipient_participant_ids=recipient_ids,
            )
        else:
            await publish_event_to_channel_subscribers(
                db,
                workspace_id=workspace_id,
                channel_id=channel.id,
                event_type="message_posted",
                source_type="message",
                source_id=str(message.id),
                actor_type=data.author_type,
                actor_id=actor_participant_id,
                actor_name=data.author_name,
                payload=payload,
            )

    if mentioned_ids:
        await publish_channel_event(
            db,
            workspace_id=workspace_id,
            channel_id=channel.id,
            event_type="mentioned_message",
            source_type="message",
            source_id=str(message.id),
            actor_type=data.author_type,
            actor_id=metadata.get("author_participant_id"),
            actor_name=data.author_name,
            payload={
                "message_id": str(message.id),
                "channel_name": channel.name,
                "title": f"Mentioned in {channel.name}",
                "subtitle": data.content[:200],
            },
            recipient_participant_ids=mentioned_ids,
        )


async def list_decisions(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> list[DecisionEvent]:
    result = await db.execute(
        select(DecisionEvent)
        .where(DecisionEvent.workspace_id == workspace_id, DecisionEvent.channel_id == channel_id)
        .order_by(DecisionEvent.created_at.asc())
    )
    return list(result.scalars())


async def create_decision(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID | None,
    data: DecisionEventCreate,
) -> DecisionEvent:
    if channel_id is not None:
        channel = await db.get(Channel, channel_id)
        if channel is not None and channel.workspace_id == workspace_id:
            channel.updated_at = datetime.now(timezone.utc)
    event = DecisionEvent(
        workspace_id=workspace_id,
        channel_id=channel_id,
        run_id=data.run_id,
        escalation_id=data.escalation_id,
        decision_type=data.decision_type,
        actor_type=data.actor_type,
        actor_name=data.actor_name,
        payload=data.payload,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event

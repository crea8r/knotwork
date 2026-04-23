from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import runs as core_runs
from modules.communication.backend import notifications_service as notification_service

from ..channels_models import Channel, ChannelEvent
from .participants import _active_channel_participant_ids


async def resolve_run_channel_id(
    db: AsyncSession,
    workspace_id: UUID,
    run_id: str,
    context: dict | None = None,
) -> UUID | None:
    context = context or {}
    raw_channel_id = context.get("channel_id")
    if raw_channel_id:
        try:
            return UUID(str(raw_channel_id))
        except ValueError:
            pass

    run = await core_runs.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        return None

    from .runs import find_run_channel_for_run, get_or_create_run_channel

    run_channel = await find_run_channel_for_run(db, run_id)
    if run_channel is not None:
        return run_channel

    created_run_channel = await get_or_create_run_channel(db, workspace_id=workspace_id, run_id=run_id, graph_id=run.graph_id)
    if created_run_channel is not None:
        return created_run_channel.id

    result = await db.execute(
        select(Channel.id).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "workflow",
            Channel.graph_id == run.graph_id,
            Channel.archived_at.is_(None),
        )
    )
    channel_id = result.scalar_one_or_none()
    if channel_id is not None:
        return channel_id

    fallback = await db.execute(
        select(Channel.id)
        .where(Channel.workspace_id == workspace_id, Channel.archived_at.is_(None))
        .order_by(Channel.created_at.asc())
        .limit(1)
    )
    return fallback.scalar_one_or_none()


async def publish_channel_event(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    channel_id: UUID,
    event_type: str,
    event_kind: str = "informational",
    source_type: str = "system",
    source_id: str | None = None,
    actor_type: str = "system",
    actor_id: str | None = None,
    actor_name: str | None = None,
    payload: dict | None = None,
    recipient_participant_ids: list[str] | None = None,
) -> ChannelEvent:
    active_subscribers = await _active_channel_participant_ids(db, workspace_id, channel_id)

    event = ChannelEvent(
        workspace_id=workspace_id,
        channel_id=channel_id,
        event_type=event_type,
        event_kind=event_kind,
        source_type=source_type,
        source_id=source_id,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_name=actor_name,
        payload=payload or {},
    )
    db.add(event)
    await db.flush()

    seen: set[str] = set()
    for participant_id in recipient_participant_ids or []:
        if participant_id not in active_subscribers or participant_id in seen:
            continue
        seen.add(participant_id)
        await notification_service.deliver_event_to_participant(db, event=event, participant_id=participant_id)

    await db.commit()
    await db.refresh(event)
    return event


async def publish_event_to_channel_subscribers(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    channel_id: UUID,
    event_type: str,
    event_kind: str = "informational",
    source_type: str = "system",
    source_id: str | None = None,
    actor_type: str = "system",
    actor_id: str | None = None,
    actor_name: str | None = None,
    payload: dict | None = None,
    exclude_participant_ids: list[str] | None = None,
) -> ChannelEvent:
    active_subscribers = await _active_channel_participant_ids(db, workspace_id, channel_id)
    excluded = {participant_id for participant_id in exclude_participant_ids or [] if participant_id}
    recipient_ids = [
        participant_id
        for participant_id in active_subscribers
        if participant_id != actor_id and participant_id not in excluded
    ]
    return await publish_channel_event(
        db,
        workspace_id=workspace_id,
        channel_id=channel_id,
        event_type=event_type,
        event_kind=event_kind,
        source_type=source_type,
        source_id=source_id,
        actor_type=actor_type,
        actor_id=actor_id,
        actor_name=actor_name,
        payload=payload,
        recipient_participant_ids=recipient_ids,
    )

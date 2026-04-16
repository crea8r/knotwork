from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import runs as core_runs
from libs.participants import agent_participant_id

from ..channels_models import Channel
from ..channels_schemas import ChannelMessageCreate
from .assets import list_bound_channel_ids_for_asset
from .bootstrap import _generate_channel_slug
from .events import publish_channel_event, publish_event_to_channel_subscribers
from .messages import create_message
from .participants import ensure_default_channel_subscriptions, sync_channel_participants


async def find_workflow_channel_for_run(db: AsyncSession, run_id: str) -> UUID | None:
    run = await core_runs.get_run(db, run_id)
    if not run:
        return None
    result = await db.execute(
        select(Channel.id).where(
            Channel.workspace_id == run.workspace_id,
            Channel.channel_type == "workflow",
            Channel.graph_id == run.graph_id,
            Channel.archived_at.is_(None),
        )
    )
    row = result.first()
    return row[0] if row else None


async def find_run_channel_for_run(db: AsyncSession, run_id: str) -> UUID | None:
    result = await db.execute(
        select(Channel.id).where(Channel.channel_type == "run", Channel.name == f"run:{run_id}", Channel.archived_at.is_(None))
    )
    row = result.first()
    return row[0] if row else None


async def get_or_create_run_channel(
    db: AsyncSession,
    workspace_id: UUID,
    run_id: str,
    graph_id: UUID | None = None,
    participant_ids: set[str] | list[str] | None = None,
) -> Channel:
    existing = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "run",
            Channel.name == f"run:{run_id}",
            Channel.archived_at.is_(None),
        )
    )
    channel = existing.scalar_one_or_none()
    normalized_participants = set(participant_ids or [])
    if channel:
        if normalized_participants:
            await sync_channel_participants(db, workspace_id, channel.id, normalized_participants)
        return channel

    channel = Channel(
        workspace_id=workspace_id,
        name=f"run:{run_id}",
        slug=await _generate_channel_slug(db, f"run {run_id}"),
        channel_type="run",
        graph_id=graph_id,
    )
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    if normalized_participants:
        await sync_channel_participants(db, workspace_id, channel.id, normalized_participants)
    else:
        await ensure_default_channel_subscriptions(db, workspace_id, channel_id=channel.id)
    return channel


async def emit_run_status_event(db: AsyncSession, *, workspace_id: UUID, run_id: str, graph_id: UUID | None, event_type: str, subtitle: str | None = None) -> None:
    run_channel = await get_or_create_run_channel(db, workspace_id=workspace_id, run_id=run_id, graph_id=graph_id)
    target_channel_ids = {run_channel.id}
    target_channel_ids.update(await list_bound_channel_ids_for_asset(db, workspace_id, asset_type="run", asset_id=str(run_id)))
    for target_channel_id in target_channel_ids:
        channel = await db.get(Channel, target_channel_id)
        if channel is None:
            continue
        await publish_event_to_channel_subscribers(
            db,
            workspace_id=workspace_id,
            channel_id=target_channel_id,
            event_type=event_type,
            source_type="run",
            source_id=run_id,
            actor_type="system",
            actor_name="Knotwork",
            payload={"run_id": run_id, "channel_name": channel.name, "title": "Run completed" if event_type == "run_completed" else "Run failed", "subtitle": subtitle or ""},
        )


async def emit_task_assigned_event(db: AsyncSession, *, workspace_id: UUID, agent_id: UUID, channel_id: UUID, title: str, subtitle: str | None = None, source_id: str | None = None) -> None:
    await publish_channel_event(
        db,
        workspace_id=workspace_id,
        channel_id=channel_id,
        event_type="task_assigned",
        event_kind="actionable",
        source_type="task",
        source_id=source_id,
        actor_type="system",
        actor_name="Knotwork",
        payload={"channel_name": "agent-main", "title": title, "subtitle": subtitle or ""},
        recipient_participant_ids=[agent_participant_id(agent_id)],
    )


async def emit_asset_activity_message(db: AsyncSession, *, workspace_id: UUID, asset_type: str, asset_id: str, content: str, metadata: dict | None = None) -> None:
    channel_ids = await list_bound_channel_ids_for_asset(db, workspace_id, asset_type=asset_type, asset_id=str(asset_id))
    for channel_id in channel_ids:
        await create_message(
            db,
            workspace_id,
            channel_id,
            ChannelMessageCreate(
                role="system",
                author_type="system",
                author_name="Knotwork",
                content=content,
                metadata={"kind": "asset_event", "asset_type": asset_type, "asset_id": str(asset_id), **(metadata or {})},
            ),
        )

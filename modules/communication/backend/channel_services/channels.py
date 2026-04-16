from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..channels_models import Channel, ChannelSubscription
from ..channels_schemas import ChannelCreate, ChannelUpdate
from .bootstrap import _generate_channel_slug, ensure_bulletin_channel, ensure_handbook_channel, ensure_workflow_channels, resolve_channel_ref


async def list_channels(db: AsyncSession, workspace_id: UUID) -> list[Channel]:
    await ensure_workflow_channels(db, workspace_id)
    await ensure_handbook_channel(db, workspace_id)
    await ensure_bulletin_channel(db, workspace_id)
    result = await db.execute(
        select(Channel)
        .where(Channel.workspace_id == workspace_id, Channel.archived_at.is_(None))
        .where(Channel.channel_type.in_(("normal", "bulletin", "workflow", "handbook", "run", "project", "objective", "task", "knowledge_change")))
        .order_by(Channel.updated_at.desc(), Channel.created_at.desc())
    )
    return list(result.scalars())


async def create_channel(
    db: AsyncSession,
    workspace_id: UUID,
    data: ChannelCreate,
    *,
    initial_participant_id: str | None = None,
) -> Channel:
    if data.channel_type == "workflow" and data.graph_id is None:
        raise ValueError("workflow channels require graph_id")
    if data.channel_type != "workflow" and data.graph_id is not None:
        raise ValueError("graph_id is only valid for workflow channels")
    if data.channel_type == "project" and data.project_id is None:
        raise ValueError("project channels require project_id")
    if data.channel_type == "objective" and data.objective_id is None:
        raise ValueError("objective channels require objective_id")

    channel = Channel(
        workspace_id=workspace_id,
        name=data.name.strip(),
        slug=await _generate_channel_slug(db, data.name.strip()),
        channel_type=data.channel_type,
        graph_id=data.graph_id,
        project_id=data.project_id,
        objective_id=data.objective_id,
    )
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    if initial_participant_id is not None:
        db.add(ChannelSubscription(workspace_id=workspace_id, channel_id=channel.id, participant_id=initial_participant_id))
        await db.commit()
        await db.refresh(channel)
    return channel


async def update_channel(db: AsyncSession, workspace_id: UUID, channel_id: UUID | str, data: ChannelUpdate) -> Channel | None:
    channel = await get_channel(db, workspace_id, channel_id)
    if channel is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    if "name" in payload and payload["name"] is not None:
        name = payload["name"].strip()
        if not name:
            raise ValueError("Channel name cannot be empty")
        channel.name = name
        if channel.channel_type == "normal":
            channel.slug = await _generate_channel_slug(db, name)
    if "archived" in payload and payload["archived"] is not None:
        if channel.channel_type != "normal":
            raise ValueError("Only normal channels can be archived")
        channel.archived_at = datetime.now(timezone.utc) if payload["archived"] else None
    await db.commit()
    await db.refresh(channel)
    return channel


async def get_channel(db: AsyncSession, workspace_id: UUID, channel_id: UUID | str) -> Channel | None:
    if isinstance(channel_id, UUID):
        channel = await db.get(Channel, channel_id)
        if not channel or channel.workspace_id != workspace_id or channel.archived_at is not None:
            return None
        return channel
    return await resolve_channel_ref(db, workspace_id, channel_id)

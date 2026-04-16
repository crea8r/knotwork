from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import graphs as core_graphs
from libs.slugs import make_slug_candidate, parse_uuid_ref

from ..channels_models import Channel


async def _generate_channel_slug(db: AsyncSession, name: str) -> str:
    while True:
        slug = make_slug_candidate(name, "channel")
        existing = await db.execute(select(Channel.id).where(Channel.slug == slug))
        if existing.scalar_one_or_none() is None:
            return slug


async def resolve_channel_ref(db: AsyncSession, workspace_id: UUID, channel_ref: str) -> Channel | None:
    channel_uuid = parse_uuid_ref(channel_ref)
    stmt = select(Channel).where(Channel.workspace_id == workspace_id, Channel.archived_at.is_(None))
    if channel_uuid is not None:
        stmt = stmt.where((Channel.id == channel_uuid) | (Channel.slug == channel_ref))
    else:
        stmt = stmt.where(Channel.slug == channel_ref)
    result = await db.execute(stmt.limit(1))
    return result.scalar_one_or_none()


async def ensure_workflow_channels(db: AsyncSession, workspace_id: UUID) -> None:
    graphs = await core_graphs.list_workspace_graphs(db, workspace_id)
    existing_rows = await db.execute(
        select(Channel.graph_id).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "workflow",
            Channel.graph_id.is_not(None),
        )
    )
    existing_graph_ids = {row[0] for row in existing_rows.all() if row[0] is not None}

    created = False
    for graph in graphs:
        if graph.id in existing_graph_ids:
            continue
        db.add(
            Channel(
                workspace_id=workspace_id,
                name=f"wf: {graph.name}",
                slug=await _generate_channel_slug(db, graph.name),
                channel_type="workflow",
                graph_id=graph.id,
            )
        )
        created = True

    if created:
        await db.commit()


async def ensure_handbook_channel(db: AsyncSession, workspace_id: UUID) -> None:
    existing = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.name == "handbook-chat",
            Channel.archived_at.is_(None),
        )
    )
    channels = list(existing.scalars())
    if not channels:
        db.add(
            Channel(
                workspace_id=workspace_id,
                name="handbook-chat",
                slug=await _generate_channel_slug(db, "handbook chat"),
                channel_type="handbook",
                graph_id=None,
            )
        )
        await db.commit()
        return

    updated = False
    for channel in channels:
        if channel.channel_type != "handbook":
            channel.channel_type = "handbook"
            updated = True
    if updated:
        await db.commit()


async def ensure_bulletin_channel(db: AsyncSession, workspace_id: UUID) -> None:
    existing = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "bulletin",
            Channel.archived_at.is_(None),
        )
    )
    if existing.scalar_one_or_none() is not None:
        return

    db.add(
        Channel(
            workspace_id=workspace_id,
            name="Workspace Bulletin",
            slug=await _generate_channel_slug(db, "workspace bulletin"),
            channel_type="bulletin",
        )
    )
    await db.commit()

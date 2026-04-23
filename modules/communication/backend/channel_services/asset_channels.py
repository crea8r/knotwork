from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import graphs as core_graphs
from core.api import knowledge as core_knowledge

from ..channels_models import Channel
from ..channels_schemas import ChannelCreate
from .assets import attach_asset_to_channel, list_bound_channel_ids_for_asset
from .bootstrap import _generate_channel_slug, ensure_handbook_channel
from .channels import create_channel
from .participants import ensure_default_channel_subscriptions


async def get_or_create_asset_chat_channel(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    asset_type: str,
    path: str | None = None,
    asset_id: str | None = None,
    project_id: UUID | None = None,
) -> Channel:
    if asset_type == "folder":
        return await _get_or_create_folder_channel(db, workspace_id, path=path, asset_id=asset_id, project_id=project_id)
    if asset_type == "file":
        return await _get_or_create_file_channel(db, workspace_id, path=path, asset_id=asset_id, project_id=project_id)
    if asset_type == "workflow":
        return await _get_or_create_workflow_channel(db, workspace_id, path=path, asset_id=asset_id, project_id=project_id)
    raise ValueError("Unsupported asset type")


async def _get_or_create_folder_channel(db: AsyncSession, workspace_id: UUID, *, path: str | None, asset_id: str | None, project_id: UUID | None) -> Channel:
    normalized_path = (path or "").strip("/")
    if not normalized_path:
        return await _root_folder_channel(db, workspace_id, project_id=project_id)

    folder = await core_knowledge.get_folder(db, UUID(asset_id)) if asset_id else None
    if folder is None:
        folder = await core_knowledge.create_folder(db, workspace_id, normalized_path, project_id=project_id)
    return await _bound_asset_channel(
        db,
        workspace_id,
        asset_type="folder",
        asset_id=str(folder.id),
        channel_name=f"folder: {normalized_path}",
        project_id=project_id,
    )


async def _root_folder_channel(db: AsyncSession, workspace_id: UUID, *, project_id: UUID | None) -> Channel:
    if project_id is None:
        await ensure_handbook_channel(db, workspace_id)
        result = await db.execute(
            select(Channel).where(Channel.workspace_id == workspace_id, Channel.channel_type == "handbook", Channel.archived_at.is_(None)).limit(1)
        )
        channel = result.scalar_one_or_none()
        if channel is None:
            raise ValueError("Handbook channel not found")
        return channel

    result = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.project_id == project_id,
            Channel.channel_type == "normal",
            Channel.name == "project assets",
            Channel.archived_at.is_(None),
        ).limit(1)
    )
    channel = result.scalar_one_or_none()
    if channel is not None:
        return channel

    channel = Channel(
        workspace_id=workspace_id,
        name="project assets",
        slug=await _generate_channel_slug(db, "project assets"),
        channel_type="normal",
        project_id=project_id,
    )
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=channel.id)
    return channel


async def _get_or_create_file_channel(db: AsyncSession, workspace_id: UUID, *, path: str | None, asset_id: str | None, project_id: UUID | None) -> Channel:
    knowledge_file = await core_knowledge.get_file(db, UUID(asset_id)) if asset_id else None
    if knowledge_file is None and path:
        knowledge_file = await core_knowledge.get_file_by_path(db, workspace_id, path, project_id=project_id)
    if knowledge_file is None:
        raise ValueError("File not found")
    return await _bound_asset_channel(
        db,
        workspace_id,
        asset_type="file",
        asset_id=str(knowledge_file.id),
        channel_name=f"file: {knowledge_file.path}",
        project_id=knowledge_file.project_id,
    )


async def _get_or_create_workflow_channel(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    path: str | None,
    asset_id: str | None,
    project_id: UUID | None,
) -> Channel:
    graph = None
    if asset_id:
        try:
            graph = await core_graphs.get_graph(db, UUID(asset_id))
        except ValueError:
            graph = None
    if graph is None and path:
        graph = await core_graphs.get_graph_by_asset_path(db, workspace_id, path, project_id=project_id)
    if graph is None or graph.workspace_id != workspace_id:
        raise ValueError("Workflow not found")
    return await _bound_asset_channel(
        db,
        workspace_id,
        asset_type="workflow",
        asset_id=str(graph.id),
        channel_name=f"workflow: {graph.name}",
        project_id=graph.project_id,
    )


async def _bound_asset_channel(db: AsyncSession, workspace_id: UUID, *, asset_type: str, asset_id: str, channel_name: str, project_id: UUID | None) -> Channel:
    for channel_id in await list_bound_channel_ids_for_asset(db, workspace_id, asset_type=asset_type, asset_id=asset_id):
        channel = await db.get(Channel, channel_id)
        if channel and channel.workspace_id == workspace_id and channel.archived_at is None:
            return channel
    channel = await create_channel(db, workspace_id, ChannelCreate(name=channel_name, channel_type="normal"))
    if project_id is not None:
        channel.project_id = project_id
        await db.commit()
        await db.refresh(channel)
    await attach_asset_to_channel(db, workspace_id, channel.id, asset_type=asset_type, asset_id=asset_id)
    return channel

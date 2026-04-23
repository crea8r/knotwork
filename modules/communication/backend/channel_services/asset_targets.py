from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import graphs as core_graphs
from core.api import knowledge as core_knowledge
from core.api import projects as core_projects
from core.api import runs as core_runs

from ..channels_models import Channel, ChannelAssetBinding


async def resolve_channel_asset_target(
    db: AsyncSession,
    channel_id: UUID,
    *,
    preferred_run_id: str | None = None,
) -> dict[str, str | None]:
    channel = await db.get(Channel, channel_id)
    if channel is None:
        return {"asset_type": None, "asset_id": None, "asset_path": None, "asset_project_slug": None}
    if channel.channel_type == "handbook":
        return {"asset_type": "folder", "asset_id": None, "asset_path": "", "asset_project_slug": None}
    if channel.channel_type == "normal" and channel.name == "project assets":
        return {"asset_type": "folder", "asset_id": None, "asset_path": "", "asset_project_slug": await _project_slug(db, channel.project_id)}
    if channel.graph_id is not None:
        graph = await core_graphs.get_graph(db, channel.graph_id)
        project_id = graph.project_id if graph is not None and graph.project_id is not None else channel.project_id
        return {
            "asset_type": "workflow",
            "asset_id": str(channel.graph_id),
            "asset_path": None if graph is None else core_graphs.graph_asset_path(graph),
            "asset_project_slug": await _project_slug(db, project_id),
        }

    binding = await _primary_binding(db, channel, preferred_run_id=preferred_run_id)
    if binding is None:
        return {"asset_type": None, "asset_id": None, "asset_path": None, "asset_project_slug": None}

    asset_path, project_id = await _binding_context(db, binding, channel.project_id)
    return {
        "asset_type": binding.asset_type,
        "asset_id": binding.asset_id,
        "asset_path": asset_path,
        "asset_project_slug": await _project_slug(db, project_id),
    }


async def _primary_binding(db: AsyncSession, channel: Channel, *, preferred_run_id: str | None) -> ChannelAssetBinding | None:
    if preferred_run_id:
        preferred_binding_result = await db.execute(
            select(ChannelAssetBinding)
            .where(
                ChannelAssetBinding.workspace_id == channel.workspace_id,
                ChannelAssetBinding.channel_id == channel.id,
                ChannelAssetBinding.asset_type == "run",
                ChannelAssetBinding.asset_id == preferred_run_id,
            )
            .limit(1)
        )
        binding = preferred_binding_result.scalar_one_or_none()
        if binding is not None:
            return binding
    binding_result = await db.execute(
        select(ChannelAssetBinding)
        .where(ChannelAssetBinding.workspace_id == channel.workspace_id, ChannelAssetBinding.channel_id == channel.id)
        .order_by(ChannelAssetBinding.created_at.asc())
        .limit(1)
    )
    return binding_result.scalar_one_or_none()


async def _binding_context(db: AsyncSession, binding: ChannelAssetBinding, project_id: UUID | None) -> tuple[str | None, UUID | None]:
    if binding.asset_type == "workflow":
        graph = await _safe_get_graph(db, binding.asset_id)
        return (
            None if graph is None else core_graphs.graph_asset_path(graph),
            graph.project_id if graph is not None and graph.project_id is not None else project_id,
        )
    if binding.asset_type == "run":
        run = await core_runs.get_run(db, binding.asset_id)
        return None, run.project_id if run is not None and run.project_id is not None else project_id
    if binding.asset_type == "file":
        file = await _safe_get_file(db, binding.asset_id)
        return (None if file is None else file.path), file.project_id if file is not None and file.project_id is not None else project_id
    if binding.asset_type == "folder":
        folder = await _safe_get_folder(db, binding.asset_id)
        return (None if folder is None else folder.path), folder.project_id if folder is not None and folder.project_id is not None else project_id
    return None, project_id


async def _project_slug(db: AsyncSession, project_id: UUID | None) -> str | None:
    if project_id is None:
        return None
    project = await core_projects.get_project(db, project_id)
    return None if project is None else project.slug


async def _safe_get_graph(db: AsyncSession, graph_id: str):
    try:
        return await core_graphs.get_graph(db, UUID(graph_id))
    except ValueError:
        return None


async def _safe_get_file(db: AsyncSession, file_id: str):
    try:
        return await core_knowledge.get_file(db, UUID(file_id))
    except ValueError:
        return None


async def _safe_get_folder(db: AsyncSession, folder_id: str):
    try:
        return await core_knowledge.get_folder(db, UUID(folder_id))
    except ValueError:
        return None

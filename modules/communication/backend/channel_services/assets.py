from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import graphs as core_graphs
from core.api import knowledge as core_knowledge
from core.api import runs as core_runs

from ..channels_models import Channel, ChannelAssetBinding
from ..channels_schemas import ChannelMessageCreate


async def list_channel_asset_bindings(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> list[dict]:
    result = await db.execute(
        select(ChannelAssetBinding)
        .where(ChannelAssetBinding.workspace_id == workspace_id, ChannelAssetBinding.channel_id == channel_id)
        .order_by(ChannelAssetBinding.created_at.asc())
    )
    bindings = list(result.scalars())
    out: list[dict] = []
    for binding in bindings:
        row = await _binding_view(db, workspace_id, binding)
        if row is not None:
            out.append(row)
    return out


async def _binding_view(db: AsyncSession, workspace_id: UUID, binding: ChannelAssetBinding) -> dict | None:
    if binding.asset_type == "workflow":
        graph = await core_graphs.get_graph(db, UUID(binding.asset_id))
        if not graph or graph.workspace_id != workspace_id:
            return None
        return _binding_payload(binding, graph.name, core_graphs.graph_asset_path(graph), graph.status)
    if binding.asset_type == "run":
        run = await core_runs.get_run(db, binding.asset_id)
        if not run or run.workspace_id != workspace_id:
            return None
        return _binding_payload(binding, run.name or f"Run {run.id[:8]}", None, run.status)
    if binding.asset_type == "file":
        knowledge_file = await core_knowledge.get_file(db, UUID(binding.asset_id))
        if not knowledge_file or knowledge_file.workspace_id != workspace_id:
            return None
        return _binding_payload(binding, knowledge_file.title, knowledge_file.path, knowledge_file.file_type)
    if binding.asset_type == "folder":
        folder = await core_knowledge.get_folder(db, UUID(binding.asset_id))
        if not folder or folder.workspace_id != workspace_id:
            return None
        label = folder.path.split("/")[-1] if folder.path else "Workspace Assets"
        return _binding_payload(binding, label, folder.path, None)
    return None


def _binding_payload(binding: ChannelAssetBinding, display_name: str, path: str | None, status: str | None) -> dict:
    return {
        "id": str(binding.id),
        "channel_id": binding.channel_id,
        "asset_type": binding.asset_type,
        "asset_id": binding.asset_id,
        "display_name": display_name,
        "path": path,
        "status": status,
        "created_at": binding.created_at,
    }


async def list_bound_channel_ids_for_asset(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    asset_type: str,
    asset_id: str,
) -> list[UUID]:
    result = await db.execute(
        select(ChannelAssetBinding.channel_id).where(
            ChannelAssetBinding.workspace_id == workspace_id,
            ChannelAssetBinding.asset_type == asset_type,
            ChannelAssetBinding.asset_id == asset_id,
        )
    )
    return [row[0] for row in result.all()]


async def detach_asset_binding(db: AsyncSession, workspace_id: UUID, channel_id: UUID, binding_id: UUID) -> None:
    binding = await db.get(ChannelAssetBinding, binding_id)
    if not binding or binding.workspace_id != workspace_id or binding.channel_id != channel_id:
        raise ValueError("Asset binding not found")
    await db.delete(binding)
    await db.commit()


async def attach_asset_to_channel(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    *,
    asset_type: str,
    asset_id: str,
) -> ChannelAssetBinding:
    from .messages import create_message

    channel = await db.get(Channel, channel_id)
    if channel is None or channel.workspace_id != workspace_id or channel.archived_at is not None:
        raise ValueError("Channel not found")
    if channel.channel_type != "normal":
        raise ValueError("Assets can only be attached to free chat channels")

    normalized_asset_id, display_name = await _resolve_asset_attachment(db, workspace_id, asset_type, asset_id)
    existing = await db.execute(
        select(ChannelAssetBinding).where(
            ChannelAssetBinding.workspace_id == workspace_id,
            ChannelAssetBinding.channel_id == channel_id,
            ChannelAssetBinding.asset_type == asset_type,
            ChannelAssetBinding.asset_id == normalized_asset_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row is not None:
        return row

    channel.updated_at = datetime.now(timezone.utc)
    row = ChannelAssetBinding(
        workspace_id=workspace_id,
        channel_id=channel_id,
        asset_type=asset_type,
        asset_id=normalized_asset_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await create_message(
        db,
        workspace_id,
        channel_id,
        ChannelMessageCreate(
            role="system",
            author_type="system",
            author_name="Knotwork",
            content=f"{asset_type.title()} attached: {display_name}",
            metadata={"kind": "asset_attached", "asset_type": asset_type, "asset_id": normalized_asset_id},
        ),
    )
    return row


async def _resolve_asset_attachment(
    db: AsyncSession,
    workspace_id: UUID,
    asset_type: str,
    asset_id: str,
) -> tuple[str, str]:
    if asset_type == "workflow":
        graph = await core_graphs.get_graph(db, UUID(asset_id))
        if not graph or graph.workspace_id != workspace_id:
            raise ValueError("Workflow not found")
        return str(graph.id), graph.name
    if asset_type == "run":
        run = await core_runs.get_run(db, asset_id)
        if not run or run.workspace_id != workspace_id:
            raise ValueError("Run not found")
        if run.status in {"completed", "failed", "stopped"}:
            raise ValueError("Completed or failed runs cannot be attached")
        return str(run.id), run.name or f"Run {run.id[:8]}"
    if asset_type == "file":
        knowledge_file = await core_knowledge.get_file(db, UUID(asset_id))
        if not knowledge_file or knowledge_file.workspace_id != workspace_id:
            raise ValueError("File not found")
        return str(knowledge_file.id), knowledge_file.title
    if asset_type == "folder":
        folder = await core_knowledge.get_folder(db, UUID(asset_id))
        if not folder or folder.workspace_id != workspace_id:
            raise ValueError("Folder not found")
        return str(folder.id), folder.path or "Workspace Assets"
    raise ValueError("Unsupported asset type")

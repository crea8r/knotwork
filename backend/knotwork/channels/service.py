from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.models import User
from knotwork.channels.models import Channel, ChannelAssetBinding, ChannelEvent, ChannelMessage, ChannelSubscription, DecisionEvent
from knotwork.channels.schemas import ChannelCreate, ChannelMessageCreate, ChannelUpdate, DecisionEventCreate
from knotwork.graphs.models import Graph
from knotwork.knowledge.models import KnowledgeChange, KnowledgeFile, KnowledgeFolder
from knotwork.notifications import service as notification_service
from knotwork.notifications.models import EventDelivery
from knotwork.projects.models import Objective, Project
from knotwork.participants import (
    agent_participant_id,
    list_workspace_agent_participants,
    list_workspace_human_participants,
    member_participant_id,
    resolve_mentioned_participants,
)
from knotwork.runs.models import Run
from knotwork.escalations.models import Escalation
from knotwork.utils.slugs import make_slug_candidate, parse_uuid_ref
from knotwork.workspaces.models import WorkspaceMember


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
    graph_rows = await db.execute(
        select(Graph.id, Graph.name).where(Graph.workspace_id == workspace_id)
    )
    graphs = list(graph_rows.all())

    existing_rows = await db.execute(
        select(Channel.graph_id).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "workflow",
            Channel.graph_id.is_not(None),
        )
    )
    existing_graph_ids = {row[0] for row in existing_rows.all() if row[0] is not None}

    created = False
    for graph_id, graph_name in graphs:
        if graph_id in existing_graph_ids:
            continue
        db.add(
            Channel(
                workspace_id=workspace_id,
                name=f"wf: {graph_name}",
                slug=await _generate_channel_slug(db, graph_name),
                channel_type="workflow",
                graph_id=graph_id,
            )
        )
        created = True

    if created:
        await db.commit()


async def ensure_handbook_channel(db: AsyncSession, workspace_id: UUID) -> None:
    """Ensure one canonical handbook chat channel exists per workspace."""
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

    # Backward compatibility: migrate older handbook chat channels from normal -> handbook.
    updated = False
    for ch in channels:
        if ch.channel_type != "handbook":
            ch.channel_type = "handbook"
            updated = True
    if updated:
        await db.commit()


async def ensure_bulletin_channel(db: AsyncSession, workspace_id: UUID) -> None:
    """Ensure one canonical workspace bulletin channel exists per workspace."""
    existing = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "bulletin",
            Channel.archived_at.is_(None),
        )
    )
    channel = existing.scalar_one_or_none()
    if channel is not None:
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


async def ensure_default_channel_subscriptions(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    channel_id: UUID | None = None,
) -> None:
    channel_query = select(Channel.id).where(
        Channel.workspace_id == workspace_id,
        Channel.archived_at.is_(None),
    )
    if channel_id is not None:
        channel_query = channel_query.where(Channel.id == channel_id)
    channel_ids = [row[0] for row in (await db.execute(channel_query)).all()]
    if not channel_ids:
        return

    participants = await list_workspace_human_participants(db, workspace_id)
    participants.extend(await list_workspace_agent_participants(db, workspace_id))
    participant_ids = {participant["participant_id"] for participant in participants}
    if not participant_ids:
        return

    existing_rows = await db.execute(
        select(ChannelSubscription.channel_id, ChannelSubscription.participant_id).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id.in_(channel_ids),
        )
    )
    existing = {(row[0], row[1]) for row in existing_rows.all()}
    channels_with_explicit_rows = {row[0] for row in existing}

    created = False
    for target_channel_id in channel_ids:
        if target_channel_id in channels_with_explicit_rows:
            continue
        for participant_id in participant_ids:
            db.add(
                ChannelSubscription(
                    workspace_id=workspace_id,
                    channel_id=target_channel_id,
                    participant_id=participant_id,
                )
            )
            created = True

    if created:
        await db.commit()


async def _active_channel_participant_ids(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
) -> set[str]:
    rows = await db.execute(
        select(ChannelSubscription.participant_id, ChannelSubscription.unsubscribed_at).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
        )
    )
    subscriptions = list(rows.all())
    if not subscriptions:
        participants = await list_workspace_human_participants(db, workspace_id)
        participants.extend(await list_workspace_agent_participants(db, workspace_id))
        return {participant["participant_id"] for participant in participants}
    return {participant_id for participant_id, unsubscribed_at in subscriptions if unsubscribed_at is None}


async def list_channel_participants(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
) -> list[dict]:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.workspace_id != workspace_id or channel.archived_at is not None:
        raise ValueError("Channel not found")

    participants = await list_workspace_human_participants(db, workspace_id)
    participants.extend(await list_workspace_agent_participants(db, workspace_id))
    participants_by_id = {participant["participant_id"]: participant for participant in participants}

    rows = await db.execute(
        select(ChannelSubscription).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
        )
    )
    subscriptions = list(rows.scalars())
    if not subscriptions:
        return [
            {
                "channel_id": channel_id,
                "participant_id": participant["participant_id"],
                "display_name": participant["display_name"],
                "mention_handle": participant.get("mention_handle"),
                "kind": participant["kind"],
                "email": participant.get("email"),
                "avatar_url": participant.get("avatar_url"),
                "agent_zero_role": bool(participant.get("agent_zero_role")),
                "contribution_brief": participant.get("contribution_brief"),
                "availability_status": participant.get("availability_status") or "available",
                "capacity_level": participant.get("capacity_level") or "open",
                "status_note": participant.get("status_note"),
                "status_updated_at": participant.get("status_updated_at"),
                "subscribed": True,
                "implicit": True,
                "subscribed_at": None,
                "unsubscribed_at": None,
            }
            for participant in participants
        ]

    out: list[dict] = []
    seen: set[str] = set()
    for subscription in subscriptions:
        participant = participants_by_id.get(subscription.participant_id)
        if participant is None:
            continue
        seen.add(subscription.participant_id)
        out.append(
            {
                "channel_id": channel_id,
                "participant_id": subscription.participant_id,
                "display_name": participant["display_name"],
                "mention_handle": participant.get("mention_handle"),
                "kind": participant["kind"],
                "email": participant.get("email"),
                "avatar_url": participant.get("avatar_url"),
                "agent_zero_role": bool(participant.get("agent_zero_role")),
                "contribution_brief": participant.get("contribution_brief"),
                "availability_status": participant.get("availability_status") or "available",
                "capacity_level": participant.get("capacity_level") or "open",
                "status_note": participant.get("status_note"),
                "status_updated_at": participant.get("status_updated_at"),
                "subscribed": subscription.unsubscribed_at is None,
                "implicit": False,
                "subscribed_at": subscription.subscribed_at,
                "unsubscribed_at": subscription.unsubscribed_at,
            }
        )
    for participant in participants:
        if participant["participant_id"] in seen:
            continue
        out.append(
            {
                "channel_id": channel_id,
                "participant_id": participant["participant_id"],
                "display_name": participant["display_name"],
                "mention_handle": participant.get("mention_handle"),
                "kind": participant["kind"],
                "email": participant.get("email"),
                "avatar_url": participant.get("avatar_url"),
                "agent_zero_role": bool(participant.get("agent_zero_role")),
                "contribution_brief": participant.get("contribution_brief"),
                "availability_status": participant.get("availability_status") or "available",
                "capacity_level": participant.get("capacity_level") or "open",
                "status_note": participant.get("status_note"),
                "status_updated_at": participant.get("status_updated_at"),
                "subscribed": False,
                "implicit": False,
                "subscribed_at": None,
                "unsubscribed_at": None,
            }
        )
    out.sort(key=lambda row: (not row["subscribed"], str(row["display_name"]).lower()))
    return out


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

    run = await db.get(Run, run_id)
    if not run or run.workspace_id != workspace_id:
        return None

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
        if participant_id not in active_subscribers:
            continue
        if participant_id in seen:
            continue
        seen.add(participant_id)
        await notification_service.deliver_event_to_participant(
            db,
            event=event,
            participant_id=participant_id,
        )

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
) -> ChannelEvent:
    active_subscribers = await _active_channel_participant_ids(db, workspace_id, channel_id)
    recipient_ids = [participant_id for participant_id in active_subscribers if participant_id != actor_id]
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


async def list_channel_subscriptions(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
) -> list[ChannelSubscription]:
    channel_rows = await db.execute(
        select(Channel.id).where(
            Channel.workspace_id == workspace_id,
            Channel.archived_at.is_(None),
        )
    )
    channel_ids = [row[0] for row in channel_rows.all()]
    if not channel_ids:
        return []

    all_rows = await db.execute(
        select(ChannelSubscription)
        .where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id.in_(channel_ids),
        )
        .order_by(ChannelSubscription.subscribed_at.asc())
    )
    rows = list(all_rows.scalars())
    rows_by_channel: dict[UUID, list[ChannelSubscription]] = {}
    for row in rows:
        rows_by_channel.setdefault(row.channel_id, []).append(row)

    out: list[ChannelSubscription] = []
    for channel_id in channel_ids:
        channel_rows_for_id = rows_by_channel.get(channel_id, [])
        if not channel_rows_for_id:
            out.append(
                SimpleNamespace(
                    channel_id=channel_id,
                    participant_id=participant_id,
                    unsubscribed_at=None,
                    subscribed_at=None,
                )
            )
            continue
        matching = next((row for row in channel_rows_for_id if row.participant_id == participant_id), None)
        if matching is not None:
            out.append(matching)
            continue
        out.append(
            SimpleNamespace(
                channel_id=channel_id,
                participant_id=participant_id,
                unsubscribed_at=datetime.now(timezone.utc),
                subscribed_at=None,
            )
        )
    return out


async def list_channel_subscriptions_for_channel(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
) -> list[ChannelSubscription]:
    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=channel_id)
    result = await db.execute(
        select(ChannelSubscription)
        .where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
        )
        .order_by(ChannelSubscription.subscribed_at.asc())
    )
    return list(result.scalars())


async def list_channel_asset_bindings(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
) -> list[dict]:
    result = await db.execute(
        select(ChannelAssetBinding).where(
            ChannelAssetBinding.workspace_id == workspace_id,
            ChannelAssetBinding.channel_id == channel_id,
        ).order_by(ChannelAssetBinding.created_at.asc())
    )
    bindings = list(result.scalars())
    out: list[dict] = []
    for binding in bindings:
        if binding.asset_type == "workflow":
            graph = await db.get(Graph, UUID(binding.asset_id))
            if not graph or graph.workspace_id != workspace_id:
                continue
            out.append(
                {
                    "id": str(binding.id),
                    "channel_id": binding.channel_id,
                    "asset_type": "workflow",
                    "asset_id": binding.asset_id,
                    "display_name": graph.name,
                    "path": graph.path,
                    "status": graph.status,
                    "created_at": binding.created_at,
                }
            )
            continue
        if binding.asset_type == "run":
            run = await db.get(Run, binding.asset_id)
            if not run or run.workspace_id != workspace_id:
                continue
            out.append(
                {
                    "id": str(binding.id),
                    "channel_id": binding.channel_id,
                    "asset_type": "run",
                    "asset_id": binding.asset_id,
                    "display_name": run.name or f"Run {run.id[:8]}",
                    "path": None,
                    "status": run.status,
                    "created_at": binding.created_at,
                }
            )
            continue
        if binding.asset_type == "file":
            kf = await db.get(KnowledgeFile, UUID(binding.asset_id))
            if not kf or kf.workspace_id != workspace_id:
                continue
            out.append(
                {
                    "id": str(binding.id),
                    "channel_id": binding.channel_id,
                    "asset_type": "file",
                    "asset_id": binding.asset_id,
                    "display_name": kf.title,
                    "path": kf.path,
                    "status": kf.file_type,
                    "created_at": binding.created_at,
                }
            )
            continue
        if binding.asset_type == "folder":
            folder = await db.get(KnowledgeFolder, UUID(binding.asset_id))
            if not folder or folder.workspace_id != workspace_id:
                continue
            out.append(
                {
                    "id": str(binding.id),
                    "channel_id": binding.channel_id,
                    "asset_type": "folder",
                    "asset_id": binding.asset_id,
                    "display_name": folder.path.split("/")[-1] if folder.path else "Workspace Assets",
                    "path": folder.path,
                    "status": None,
                    "created_at": binding.created_at,
                }
            )
    return out


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


async def attach_asset_to_channel(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    *,
    asset_type: str,
    asset_id: str,
) -> ChannelAssetBinding:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.workspace_id != workspace_id or channel.archived_at is not None:
        raise ValueError("Channel not found")
    if channel.channel_type != "normal":
        raise ValueError("Assets can only be attached to free chat channels")

    normalized_asset_id = asset_id
    display_name = ""
    if asset_type == "workflow":
        graph = await db.get(Graph, UUID(asset_id))
        if not graph or graph.workspace_id != workspace_id:
            raise ValueError("Workflow not found")
        normalized_asset_id = str(graph.id)
        display_name = graph.name
    elif asset_type == "run":
        run = await db.get(Run, asset_id)
        if not run or run.workspace_id != workspace_id:
            raise ValueError("Run not found")
        if run.status in {"completed", "failed", "stopped"}:
            raise ValueError("Completed or failed runs cannot be attached")
        normalized_asset_id = str(run.id)
        display_name = run.name or f"Run {run.id[:8]}"
    elif asset_type == "file":
        kf = await db.get(KnowledgeFile, UUID(asset_id))
        if not kf or kf.workspace_id != workspace_id:
            raise ValueError("File not found")
        normalized_asset_id = str(kf.id)
        display_name = kf.title
    elif asset_type == "folder":
        folder = await db.get(KnowledgeFolder, UUID(asset_id))
        if not folder or folder.workspace_id != workspace_id:
            raise ValueError("Folder not found")
        normalized_asset_id = str(folder.id)
        display_name = folder.path or "Workspace Assets"
    else:
        raise ValueError("Unsupported asset type")

    existing = await db.execute(
        select(ChannelAssetBinding).where(
            ChannelAssetBinding.workspace_id == workspace_id,
            ChannelAssetBinding.channel_id == channel_id,
            ChannelAssetBinding.asset_type == asset_type,
            ChannelAssetBinding.asset_id == normalized_asset_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row is None:
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


async def get_or_create_asset_chat_channel(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    asset_type: str,
    path: str | None = None,
    asset_id: str | None = None,
    project_id: UUID | None = None,
) -> Channel:
    from knotwork.knowledge import folder_service, service as knowledge_service

    if asset_type == "folder":
        normalized_path = (path or "").strip("/")
        if not normalized_path:
            if project_id is None:
                await ensure_handbook_channel(db, workspace_id)
                result = await db.execute(
                    select(Channel).where(
                        Channel.workspace_id == workspace_id,
                        Channel.channel_type == "handbook",
                        Channel.archived_at.is_(None),
                    ).limit(1)
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

        folder = None
        if asset_id:
            folder = await db.get(KnowledgeFolder, UUID(asset_id))
        if folder is None:
            if project_id is None:
                folder = await folder_service.create_folder(db, workspace_id, normalized_path)
            else:
                result = await db.execute(
                    select(KnowledgeFolder).where(
                        KnowledgeFolder.workspace_id == workspace_id,
                        KnowledgeFolder.project_id == project_id,
                        KnowledgeFolder.path == normalized_path,
                    ).limit(1)
                )
                folder = result.scalar_one_or_none()
                if folder is None:
                    folder = KnowledgeFolder(workspace_id=workspace_id, project_id=project_id, path=normalized_path)
                    db.add(folder)
                    await db.commit()
                    await db.refresh(folder)
        channel_ids = await list_bound_channel_ids_for_asset(
            db,
            workspace_id,
            asset_type="folder",
            asset_id=str(folder.id),
        )
        for channel_id in channel_ids:
            channel = await db.get(Channel, channel_id)
            if channel and channel.workspace_id == workspace_id and channel.archived_at is None:
                return channel
        channel = await create_channel(
            db,
            workspace_id,
            ChannelCreate(name=f"folder: {normalized_path}", channel_type="normal"),
        )
        if project_id is not None:
            channel.project_id = project_id
            await db.commit()
            await db.refresh(channel)
        await attach_asset_to_channel(db, workspace_id, channel.id, asset_type="folder", asset_id=str(folder.id))
        return channel

    if asset_type == "file":
        knowledge_file = None
        if asset_id:
            knowledge_file = await db.get(KnowledgeFile, UUID(asset_id))
        elif path:
            knowledge_file = await knowledge_service.get_file_by_path(db, workspace_id, path, project_id=project_id)
        if knowledge_file is None:
            raise ValueError("File not found")
        channel_ids = await list_bound_channel_ids_for_asset(
            db,
            workspace_id,
            asset_type="file",
            asset_id=str(knowledge_file.id),
        )
        for channel_id in channel_ids:
            channel = await db.get(Channel, channel_id)
            if channel and channel.workspace_id == workspace_id and channel.archived_at is None:
                return channel
        channel = await create_channel(
            db,
            workspace_id,
            ChannelCreate(name=f"file: {knowledge_file.path}", channel_type="normal"),
        )
        if knowledge_file.project_id is not None:
            channel.project_id = knowledge_file.project_id
            await db.commit()
            await db.refresh(channel)
        await attach_asset_to_channel(db, workspace_id, channel.id, asset_type="file", asset_id=str(knowledge_file.id))
        return channel

    if asset_type == "workflow":
        if not asset_id:
            raise ValueError("Workflow not found")
        graph = await db.get(Graph, UUID(asset_id))
        if graph is None or graph.workspace_id != workspace_id:
            raise ValueError("Workflow not found")
        channel_ids = await list_bound_channel_ids_for_asset(
            db,
            workspace_id,
            asset_type="workflow",
            asset_id=str(graph.id),
        )
        for channel_id in channel_ids:
            channel = await db.get(Channel, channel_id)
            if channel and channel.workspace_id == workspace_id and channel.archived_at is None:
                return channel
        channel = await create_channel(
            db,
            workspace_id,
            ChannelCreate(name=f"workflow: {graph.name}", channel_type="normal"),
        )
        if graph.project_id is not None:
            channel.project_id = graph.project_id
            await db.commit()
            await db.refresh(channel)
        await attach_asset_to_channel(db, workspace_id, channel.id, asset_type="workflow", asset_id=str(graph.id))
        return channel

    raise ValueError("Unsupported asset type")


async def detach_asset_binding(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    binding_id: UUID,
) -> None:
    binding = await db.get(ChannelAssetBinding, binding_id)
    if not binding or binding.workspace_id != workspace_id or binding.channel_id != channel_id:
        raise ValueError("Asset binding not found")
    await db.delete(binding)
    await db.commit()


async def set_channel_subscription(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    participant_id: str,
    *,
    subscribed: bool,
) -> ChannelSubscription:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.workspace_id != workspace_id:
        raise ValueError("Channel not found")
    if channel.channel_type == "run" and not subscribed:
        raise ValueError("Run chat participants cannot leave the channel")
    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=channel_id)
    result = await db.execute(
        select(ChannelSubscription).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
            ChannelSubscription.participant_id == participant_id,
        )
    )
    row = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None:
        row = ChannelSubscription(
            workspace_id=workspace_id,
            channel_id=channel_id,
            participant_id=participant_id,
            unsubscribed_at=None if subscribed else now,
        )
        db.add(row)
    else:
        row.unsubscribed_at = None if subscribed else now
    await db.commit()
    await db.refresh(row)
    return row


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
    ch = Channel(
        workspace_id=workspace_id,
        name=data.name.strip(),
        slug=await _generate_channel_slug(db, data.name.strip()),
        channel_type=data.channel_type,
        graph_id=data.graph_id,
        project_id=data.project_id,
        objective_id=data.objective_id,
    )
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    if initial_participant_id is not None:
        db.add(
            ChannelSubscription(
                workspace_id=workspace_id,
                channel_id=ch.id,
                participant_id=initial_participant_id,
            )
        )
        await db.commit()
        await db.refresh(ch)
    return ch


async def get_or_create_objective_agentzero_consultation(
    db: AsyncSession,
    workspace_id: UUID,
    objective_id: UUID,
    requester_member: WorkspaceMember,
    requester_user: User,
) -> Channel:
    objective = await db.get(Objective, objective_id)
    if objective is None or objective.workspace_id != workspace_id:
        raise ValueError("Objective not found")

    agentzero_row = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.agent_zero_role.is_(True),
            WorkspaceMember.access_disabled_at.is_(None),
        )
        .limit(1)
    )
    agentzero = agentzero_row.first()
    if agentzero is None:
        raise ValueError("AgentZero is not assigned")
    agentzero_member, agentzero_user = agentzero

    requester_participant_id = member_participant_id(requester_member, requester_user.id)
    agentzero_participant_id = member_participant_id(agentzero_member, agentzero_user.id)
    participant_ids = {requester_participant_id, agentzero_participant_id}

    existing_rows = await db.execute(
        select(Channel)
        .where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "consultation",
            Channel.objective_id == objective_id,
            Channel.archived_at.is_(None),
        )
        .order_by(Channel.created_at.desc())
    )
    for channel in existing_rows.scalars():
        subscription_rows = await db.execute(
            select(ChannelSubscription.participant_id).where(
                ChannelSubscription.workspace_id == workspace_id,
                ChannelSubscription.channel_id == channel.id,
                ChannelSubscription.unsubscribed_at.is_(None),
            )
        )
        if participant_ids.issubset({row[0] for row in subscription_rows.all()}):
            return channel

    label = objective.code or objective.title
    channel = Channel(
        workspace_id=workspace_id,
        name=f"AgentZero consult: {label}",
        slug=await _generate_channel_slug(db, f"agentzero consult {label}"),
        channel_type="consultation",
        project_id=objective.project_id,
        objective_id=objective.id,
    )
    db.add(channel)
    await db.flush()
    for participant_id in participant_ids:
        db.add(
            ChannelSubscription(
                workspace_id=workspace_id,
                channel_id=channel.id,
                participant_id=participant_id,
            )
        )
    await db.commit()
    await db.refresh(channel)
    return channel


async def update_channel(db: AsyncSession, workspace_id: UUID, channel_id: UUID | str, data: ChannelUpdate) -> Channel | None:
    ch = await get_channel(db, workspace_id, channel_id)
    if ch is None:
        return None
    payload = data.model_dump(exclude_unset=True)
    if "name" in payload and payload["name"] is not None:
        name = payload["name"].strip()
        if not name:
            raise ValueError("Channel name cannot be empty")
        ch.name = name
        if ch.channel_type == "normal":
            ch.slug = await _generate_channel_slug(db, name)
    if "archived" in payload and payload["archived"] is not None:
        if ch.channel_type != "normal":
            raise ValueError("Only normal channels can be archived")
        ch.archived_at = datetime.now(timezone.utc) if payload["archived"] else None
    await db.commit()
    await db.refresh(ch)
    return ch


async def get_channel(db: AsyncSession, workspace_id: UUID, channel_id: UUID | str) -> Channel | None:
    if isinstance(channel_id, UUID):
        ch = await db.get(Channel, channel_id)
        if not ch or ch.workspace_id != workspace_id or ch.archived_at is not None:
            return None
        return ch
    return await resolve_channel_ref(db, workspace_id, channel_id)


async def list_messages(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> list[ChannelMessage]:
    result = await db.execute(
        select(ChannelMessage)
        .where(
            ChannelMessage.workspace_id == workspace_id,
            ChannelMessage.channel_id == channel_id,
        )
        .order_by(ChannelMessage.created_at.asc())
    )
    return list(result.scalars())


async def create_message(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    data: ChannelMessageCreate,
) -> ChannelMessage:
    channel = await db.get(Channel, channel_id)
    if not channel or channel.workspace_id != workspace_id:
        raise ValueError("Channel not found")
    channel.updated_at = datetime.now(timezone.utc)

    metadata = dict(data.metadata or {})
    author_participant_id = metadata.get("author_participant_id")
    mentioned = await resolve_mentioned_participants(db, workspace_id, data.content)
    mentioned_ids = [
        participant["participant_id"]
        for participant in mentioned
        if participant["participant_id"] != author_participant_id
    ]
    if mentioned_ids:
        metadata["mentioned_participant_ids"] = mentioned_ids
        for participant_id in mentioned_ids:
            await set_channel_subscription(
                db,
                workspace_id,
                channel_id,
                participant_id,
                subscribed=True,
            )

    msg = ChannelMessage(
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
    db.add(msg)
    await db.flush()

    await publish_event_to_channel_subscribers(
        db,
        workspace_id=workspace_id,
        channel_id=channel_id,
        event_type="message_posted",
        event_kind="informational",
        source_type="message",
        source_id=str(msg.id),
        actor_type=data.author_type,
        actor_id=metadata.get("author_participant_id"),
        actor_name=data.author_name,
        payload={
            "message_id": str(msg.id),
            "channel_name": channel.name,
            "message_preview": data.content[:160],
        },
    )

    if mentioned_ids:
        await publish_channel_event(
            db,
            workspace_id=workspace_id,
            channel_id=channel_id,
            event_type="mentioned_message",
            event_kind="informational",
            source_type="message",
            source_id=str(msg.id),
            actor_type=data.author_type,
            actor_id=metadata.get("author_participant_id"),
            actor_name=data.author_name,
            payload={
                "message_id": str(msg.id),
                "channel_name": channel.name,
                "title": f"Mentioned in {channel.name}",
                "subtitle": data.content[:200],
            },
            recipient_participant_ids=mentioned_ids,
        )

    await db.refresh(msg)
    return msg


async def list_decisions(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> list[DecisionEvent]:
    result = await db.execute(
        select(DecisionEvent)
        .where(
            DecisionEvent.workspace_id == workspace_id,
            DecisionEvent.channel_id == channel_id,
        )
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


async def inbox_items(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
    *,
    archived: bool = False,
) -> list[dict]:
    out: list[dict] = []

    await ensure_default_channel_subscriptions(db, workspace_id)

    delivery_result = await db.execute(
        select(EventDelivery, ChannelEvent)
        .join(ChannelEvent, ChannelEvent.id == EventDelivery.event_id)
        .where(
            EventDelivery.workspace_id == workspace_id,
            EventDelivery.participant_id == participant_id,
            EventDelivery.delivery_mean == "app",
            EventDelivery.status == "sent",
            EventDelivery.archived_at.is_not(None) if archived else EventDelivery.archived_at.is_(None),
        )
        .order_by(EventDelivery.sent_at.desc())
        .limit(100)
    )
    for delivery, event in delivery_result.all():
        row = await _inbox_item_from_delivery_event(db, delivery, event)
        if row is not None:
            out.append(row)

    if not archived:
        proposal_result = await db.execute(
            select(KnowledgeChange)
            .where(
                KnowledgeChange.workspace_id == workspace_id,
                KnowledgeChange.status == "pending",
            )
            .order_by(KnowledgeChange.created_at.desc())
            .limit(100)
        )
        for p in proposal_result.scalars():
            asset_context = await _resolve_channel_asset_target(db, p.channel_id)
            out.append(
                {
                    "id": f"proposal:{p.id}",
                    "item_type": "knowledge_change",
                    "delivery_id": None,
                    "title": f"Knowledge change: {p.target_path}",
                    "subtitle": p.reason[:140],
                    "status": p.status,
                    "run_id": p.run_id,
                    "channel_id": str(p.channel_id),
                    "escalation_id": None,
                    "proposal_id": p.id,
                    "message_id": None,
                    **asset_context,
                    "due_at": None,
                    "created_at": p.created_at,
                    "unread": False,
                    "archived_at": None,
                }
            )

    out.sort(key=lambda item: item["created_at"], reverse=True)
    return out


async def _inbox_item_from_delivery_event(
    db: AsyncSession,
    delivery: EventDelivery,
    event: ChannelEvent,
) -> dict | None:
    payload = event.payload or {}
    asset_context = await _resolve_channel_asset_target(db, event.channel_id)

    if event.event_type == "escalation_created":
        escalation_id_raw = payload.get("escalation_id")
        esc = None
        if escalation_id_raw:
            try:
                esc = await db.get(Escalation, UUID(str(escalation_id_raw)))
            except ValueError:
                esc = None
        node_id = str(payload.get("node_id") or "node")
        return {
            "id": f"delivery:{delivery.id}",
            "item_type": "escalation",
            "delivery_id": str(delivery.id),
            "title": str(payload.get("title") or f"Escalation: {node_id}"),
            "subtitle": str(payload.get("subtitle") or payload.get("reason") or "Needs attention"),
            "status": esc.status if esc else ("read" if delivery.read_at else "new"),
            "run_id": str(payload.get("run_id") or "") or None,
            "channel_id": str(event.channel_id),
            "escalation_id": esc.id if esc else None,
            "proposal_id": None,
            "message_id": None,
            **asset_context,
            "due_at": esc.timeout_at if esc else None,
            "created_at": delivery.sent_at,
            "unread": delivery.read_at is None,
            "archived_at": delivery.archived_at,
        }

    if event.event_type == "mentioned_message":
        return {
            "id": f"delivery:{delivery.id}",
            "item_type": "mentioned_message",
            "delivery_id": str(delivery.id),
            "title": str(payload.get("title") or "Mentioned in channel"),
            "subtitle": str(payload.get("subtitle") or ""),
            "status": "read" if delivery.read_at else "new",
            "run_id": None,
            "channel_id": str(event.channel_id),
            "escalation_id": None,
            "proposal_id": None,
            "message_id": str(payload.get("message_id") or "") or None,
            **asset_context,
            "due_at": None,
            "created_at": delivery.sent_at,
            "unread": delivery.read_at is None,
            "archived_at": delivery.archived_at,
        }

    if event.event_type == "message_posted":
        return {
            "id": f"delivery:{delivery.id}",
            "item_type": "message_posted",
            "delivery_id": str(delivery.id),
            "title": str(payload.get("title") or f"New message in {payload.get('channel_name') or 'channel'}"),
            "subtitle": str(payload.get("subtitle") or payload.get("message_preview") or ""),
            "status": "read" if delivery.read_at else "new",
            "run_id": None,
            "channel_id": str(event.channel_id),
            "escalation_id": None,
            "proposal_id": None,
            "message_id": str(payload.get("message_id") or "") or None,
            **asset_context,
            "due_at": None,
            "created_at": delivery.sent_at,
            "unread": delivery.read_at is None,
            "archived_at": delivery.archived_at,
        }

    if event.event_type == "task_assigned":
        return {
            "id": f"delivery:{delivery.id}",
            "item_type": "task_assigned",
            "delivery_id": str(delivery.id),
            "title": str(payload.get("title") or "Task assigned"),
            "subtitle": str(payload.get("subtitle") or ""),
            "status": "read" if delivery.read_at else "new",
            "run_id": str(payload.get("run_id") or "") or None,
            "channel_id": str(event.channel_id),
            "escalation_id": None,
            "proposal_id": None,
            "message_id": None,
            **asset_context,
            "due_at": None,
            "created_at": delivery.sent_at,
            "unread": delivery.read_at is None,
            "archived_at": delivery.archived_at,
        }

    if event.event_type in ("run_failed", "run_completed"):
        return {
            "id": f"delivery:{delivery.id}",
            "item_type": "run_event",
            "delivery_id": str(delivery.id),
            "title": str(payload.get("title") or event.event_type.replace("_", " ")),
            "subtitle": str(payload.get("subtitle") or ""),
            "status": "read" if delivery.read_at else "new",
            "run_id": str(payload.get("run_id") or "") or None,
            "channel_id": str(event.channel_id),
            "escalation_id": None,
            "proposal_id": None,
            "message_id": None,
            **asset_context,
            "due_at": None,
            "created_at": delivery.sent_at,
            "unread": delivery.read_at is None,
            "archived_at": delivery.archived_at,
        }

    return None


async def inbox_item_by_delivery_id(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
    delivery_id: UUID,
) -> dict | None:
    result = await db.execute(
        select(EventDelivery, ChannelEvent)
        .join(ChannelEvent, ChannelEvent.id == EventDelivery.event_id)
        .where(
            EventDelivery.id == delivery_id,
            EventDelivery.workspace_id == workspace_id,
            EventDelivery.participant_id == participant_id,
            EventDelivery.delivery_mean == "app",
            EventDelivery.status == "sent",
        )
        .limit(1)
    )
    row = result.first()
    if row is None:
        return None
    delivery, event = row
    return await _inbox_item_from_delivery_event(db, delivery, event)


async def _resolve_channel_asset_target(db: AsyncSession, channel_id: UUID) -> dict[str, str | None]:
    channel = await db.get(Channel, channel_id)
    if channel is None:
        return {
            "asset_type": None,
            "asset_id": None,
            "asset_path": None,
            "asset_project_slug": None,
        }

    if channel.channel_type == "handbook":
        return {
            "asset_type": "folder",
            "asset_id": None,
            "asset_path": "",
            "asset_project_slug": None,
        }

    if channel.channel_type == "normal" and channel.name == "project assets":
        project_slug = None
        if channel.project_id is not None:
            project = await db.get(Project, channel.project_id)
            if project is not None:
                project_slug = project.slug
        return {
            "asset_type": "folder",
            "asset_id": None,
            "asset_path": "",
            "asset_project_slug": project_slug,
        }

    binding_result = await db.execute(
        select(ChannelAssetBinding)
        .where(
            ChannelAssetBinding.workspace_id == channel.workspace_id,
            ChannelAssetBinding.channel_id == channel_id,
        )
        .order_by(ChannelAssetBinding.created_at.asc())
        .limit(1)
    )
    binding = binding_result.scalar_one_or_none()
    if binding is None:
        return {
            "asset_type": None,
            "asset_id": None,
            "asset_path": None,
            "asset_project_slug": None,
        }

    project_id = channel.project_id
    asset_path: str | None = None

    if binding.asset_type == "workflow":
        try:
            graph = await db.get(Graph, UUID(binding.asset_id))
        except ValueError:
            graph = None
        if graph is not None:
            project_id = graph.project_id or project_id
    elif binding.asset_type == "run":
        run = await db.get(Run, binding.asset_id)
        if run is not None:
            project_id = run.project_id or project_id
    elif binding.asset_type == "file":
        try:
            file = await db.get(KnowledgeFile, UUID(binding.asset_id))
        except ValueError:
            file = None
        if file is not None:
            asset_path = file.path
            project_id = file.project_id or project_id
    elif binding.asset_type == "folder":
        try:
            folder = await db.get(KnowledgeFolder, UUID(binding.asset_id))
        except ValueError:
            folder = None
        if folder is not None:
            asset_path = folder.path
            project_id = folder.project_id or project_id

    project_slug = None
    if project_id is not None:
        project = await db.get(Project, project_id)
        if project is not None:
            project_slug = project.slug

    return {
        "asset_type": binding.asset_type,
        "asset_id": binding.asset_id,
        "asset_path": asset_path,
        "asset_project_slug": project_slug,
    }


async def inbox_summary(db: AsyncSession, workspace_id: UUID, participant_id: str) -> dict:
    await ensure_default_channel_subscriptions(db, workspace_id)
    counts_result = await db.execute(
        select(
            func.count(EventDelivery.id).filter(EventDelivery.read_at.is_(None), EventDelivery.archived_at.is_(None)),
            func.count(EventDelivery.id).filter(EventDelivery.archived_at.is_(None)),
            func.count(EventDelivery.id).filter(EventDelivery.archived_at.is_not(None)),
        ).where(
            EventDelivery.workspace_id == workspace_id,
            EventDelivery.participant_id == participant_id,
            EventDelivery.delivery_mean == "app",
            EventDelivery.status == "sent",
        )
    )
    unread_count, active_count, archived_count = counts_result.one()
    return {
        "unread_count": unread_count or 0,
        "active_count": active_count or 0,
        "archived_count": archived_count or 0,
    }


async def find_workflow_channel_for_run(db: AsyncSession, run_id: str) -> UUID | None:
    from knotwork.runs.models import Run

    run = await db.get(Run, run_id)
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
        select(Channel.id).where(
            Channel.channel_type == "run",
            Channel.name == f"run:{run_id}",
            Channel.archived_at.is_(None),
        )
    )
    row = result.first()
    return row[0] if row else None


async def get_or_create_run_channel(
    db: AsyncSession,
    workspace_id: UUID,
    run_id: str,
    graph_id: UUID | None = None,
) -> Channel:
    existing = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "run",
            Channel.name == f"run:{run_id}",
            Channel.archived_at.is_(None),
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        return row

    row = Channel(
        workspace_id=workspace_id,
        name=f"run:{run_id}",
        slug=await _generate_channel_slug(db, f"run {run_id}"),
        channel_type="run",
        graph_id=graph_id,
        project_id=None,
        objective_id=None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=row.id)
    return row



async def emit_run_status_event(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    run_id: str,
    graph_id: UUID | None,
    event_type: str,
    subtitle: str | None = None,
) -> None:
    run_channel = await get_or_create_run_channel(db, workspace_id=workspace_id, run_id=run_id, graph_id=graph_id)
    target_channel_ids = {run_channel.id}
    target_channel_ids.update(
        await list_bound_channel_ids_for_asset(db, workspace_id, asset_type="run", asset_id=str(run_id))
    )
    for target_channel_id in target_channel_ids:
        channel = await db.get(Channel, target_channel_id)
        if channel is None:
            continue
        await publish_event_to_channel_subscribers(
            db,
            workspace_id=workspace_id,
            channel_id=target_channel_id,
            event_type=event_type,
            event_kind="informational",
            source_type="run",
            source_id=run_id,
            actor_type="system",
            actor_name="Knotwork",
            payload={
                "run_id": run_id,
                "channel_name": channel.name,
                "title": "Run completed" if event_type == "run_completed" else "Run failed",
                "subtitle": subtitle or "",
            },
        )


async def emit_task_assigned_event(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    agent_id: UUID,
    channel_id: UUID,
    title: str,
    subtitle: str | None = None,
    source_id: str | None = None,
) -> None:
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
        payload={
            "channel_name": "agent-main",
            "title": title,
            "subtitle": subtitle or "",
        },
        recipient_participant_ids=[agent_participant_id(agent_id)],
    )


async def emit_asset_activity_message(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    asset_type: str,
    asset_id: str,
    content: str,
    metadata: dict | None = None,
) -> None:
    channel_ids = await list_bound_channel_ids_for_asset(
        db,
        workspace_id,
        asset_type=asset_type,
        asset_id=str(asset_id),
    )
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

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels.models import Channel, ChannelAssetBinding, ChannelEvent, ChannelMessage, ChannelSubscription, DecisionEvent
from knotwork.channels.schemas import ChannelCreate, ChannelMessageCreate, ChannelUpdate, DecisionEventCreate
from knotwork.graphs.models import Graph
from knotwork.knowledge.models import KnowledgeFile
from knotwork.notifications import service as notification_service
from knotwork.notifications.models import EventDelivery
from knotwork.participants import (
    agent_participant_id,
    list_workspace_agent_participants,
    list_workspace_human_participants,
    resolve_mentioned_participants,
)
from knotwork.runs.models import Run, RunHandbookProposal
from knotwork.escalations.models import Escalation
from knotwork.utils.slugs import make_slug_candidate, parse_uuid_ref


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

    created = False
    for target_channel_id in channel_ids:
        for participant_id in participant_ids:
            if (target_channel_id, participant_id) in existing:
                continue
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
    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=channel_id)
    subscriber_rows = await db.execute(
        select(ChannelSubscription.participant_id).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
            ChannelSubscription.unsubscribed_at.is_(None),
        )
    )
    active_subscribers = {row[0] for row in subscriber_rows.all()}

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
    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=channel_id)
    subscriber_rows = await db.execute(
        select(ChannelSubscription.participant_id).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
            ChannelSubscription.unsubscribed_at.is_(None),
        )
    )
    recipient_ids = [row[0] for row in subscriber_rows.all()]
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
    await ensure_default_channel_subscriptions(db, workspace_id)
    result = await db.execute(
        select(Channel)
        .where(Channel.workspace_id == workspace_id, Channel.archived_at.is_(None))
        .where(Channel.channel_type.in_(("normal", "bulletin", "workflow", "handbook", "run", "agent_main", "project", "objective", "task")))
        .order_by(Channel.updated_at.desc(), Channel.created_at.desc())
    )
    return list(result.scalars())


async def list_channel_subscriptions(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
) -> list[ChannelSubscription]:
    await ensure_default_channel_subscriptions(db, workspace_id)
    result = await db.execute(
        select(ChannelSubscription)
        .where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.participant_id == participant_id,
        )
        .order_by(ChannelSubscription.subscribed_at.asc())
    )
    return list(result.scalars())


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


async def create_channel(db: AsyncSession, workspace_id: UUID, data: ChannelCreate) -> Channel:
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
    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=ch.id)
    return ch


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
    mentioned = await resolve_mentioned_participants(db, workspace_id, data.content)
    mentioned_ids = [participant["participant_id"] for participant in mentioned]
    if mentioned_ids:
        metadata["mentioned_participant_ids"] = mentioned_ids

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
        payload = event.payload or {}
        if event.event_type == "escalation_created":
            escalation_id_raw = payload.get("escalation_id")
            esc = None
            if escalation_id_raw:
                try:
                    esc = await db.get(Escalation, UUID(str(escalation_id_raw)))
                except ValueError:
                    esc = None
            node_id = str(payload.get("node_id") or "node")
            out.append(
                {
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
                    "due_at": esc.timeout_at if esc else None,
                    "created_at": delivery.sent_at,
                    "unread": delivery.read_at is None,
                    "archived_at": delivery.archived_at,
                }
            )
            continue

        if event.event_type == "mentioned_message":
            out.append(
                {
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
                    "due_at": None,
                    "created_at": delivery.sent_at,
                    "unread": delivery.read_at is None,
                    "archived_at": delivery.archived_at,
                }
            )
            continue

        if event.event_type == "task_assigned":
            out.append(
                {
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
                    "due_at": None,
                    "created_at": delivery.sent_at,
                    "unread": delivery.read_at is None,
                    "archived_at": delivery.archived_at,
                }
            )
            continue

        if event.event_type in ("run_failed", "run_completed"):
            out.append(
                {
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
                    "due_at": None,
                    "created_at": delivery.sent_at,
                    "unread": delivery.read_at is None,
                    "archived_at": delivery.archived_at,
                }
            )

    if not archived:
        proposal_result = await db.execute(
            select(RunHandbookProposal)
            .where(RunHandbookProposal.status == "pending")
            .order_by(RunHandbookProposal.created_at.desc())
            .limit(100)
        )
        for p in proposal_result.scalars():
            out.append(
                {
                    "id": f"proposal:{p.id}",
                    "item_type": "handbook_proposal",
                    "delivery_id": None,
                    "title": f"Handbook proposal: {p.path}",
                    "subtitle": p.reason[:140],
                    "status": p.status,
                    "run_id": p.run_id,
                    "channel_id": None,
                    "escalation_id": None,
                    "proposal_id": p.id,
                    "due_at": None,
                    "created_at": p.created_at,
                    "unread": False,
                    "archived_at": None,
                }
            )

    out.sort(key=lambda item: item["created_at"], reverse=True)
    return out


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


async def get_or_create_agent_main_channel(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    display_name: str,
) -> Channel:
    name = f"agent-main:{agent_id}"
    existing = await db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.channel_type == "agent_main",
            Channel.name == name,
            Channel.archived_at.is_(None),
        ).limit(1)
    )
    row = existing.scalar_one_or_none()
    if row:
        return row

    row = Channel(
        workspace_id=workspace_id,
        name=name,
        slug=await _generate_channel_slug(db, display_name),
        channel_type="agent_main",
        graph_id=None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=row.id)

    await create_message(
        db,
        workspace_id,
        row.id,
        ChannelMessageCreate(
            role="system",
            author_type="system",
            author_name="Knotwork",
            content=f"Main session chat for agent: {display_name}",
            metadata={"kind": "main_session_init", "agent_id": str(agent_id)},
        ),
    )
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

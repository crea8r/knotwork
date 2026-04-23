from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import knowledge as core_knowledge
from modules.workflows.backend.runs.escalations_models import Escalation

from ..channels_models import ChannelEvent, ChannelMessage
from ..notifications_models import EventDelivery
from .asset_targets import resolve_channel_asset_target
from .inbox_rows import _inbox_row, _load_escalation, _load_event_message
from .messages import _is_non_actionable_message_kind
from .participants import ensure_default_channel_subscriptions


async def inbox_items(db: AsyncSession, workspace_id: UUID, participant_id: str, *, archived: bool = False) -> list[dict]:
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
        for proposal in (await core_knowledge.list_pending_changes(db, workspace_id))[:100]:
            asset_context = await resolve_channel_asset_target(db, proposal.channel_id)
            out.append(
                {
                    "id": f"proposal:{proposal.id}",
                    "item_type": "knowledge_change",
                    "delivery_id": None,
                    "title": f"Knowledge change: {proposal.target_path}",
                    "subtitle": proposal.reason[:140],
                    "status": proposal.status,
                    "run_id": proposal.run_id,
                    "channel_id": str(proposal.channel_id),
                    "escalation_id": None,
                    "proposal_id": proposal.id,
                    "message_id": None,
                    **asset_context,
                    "due_at": None,
                    "created_at": proposal.created_at,
                    "unread": False,
                    "archived_at": None,
                }
            )

    out.sort(key=lambda item: item["created_at"], reverse=True)
    return out


async def _message_run_context(db: AsyncSession, event: ChannelEvent) -> tuple[str | None, dict[str, str | None] | None]:
    if event.source_type != "message" or not event.source_id:
        return None, None
    try:
        message = await db.get(ChannelMessage, UUID(str(event.source_id)))
    except ValueError:
        return None, None
    if message is None or message.run_id is None:
        return None, None
    run_id = str(message.run_id)
    return run_id, await resolve_channel_asset_target(db, event.channel_id, preferred_run_id=run_id)


def _should_skip_inbox_for_message(message: ChannelMessage | None) -> bool:
    return bool(message and _is_non_actionable_message_kind(str((message.metadata_ or {}).get("kind") or "")))


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
    return None if row is None else await _inbox_item_from_delivery_event(db, row[0], row[1])


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
    return {"unread_count": unread_count or 0, "active_count": active_count or 0, "archived_count": archived_count or 0}


async def _inbox_item_from_delivery_event(db: AsyncSession, delivery: EventDelivery, event: ChannelEvent) -> dict | None:
    payload = event.payload or {}
    message = await _load_event_message(db, event)
    if _should_skip_inbox_for_message(message):
        return None
    message_run_id, asset_context = await _message_run_context(db, event)
    asset_context = asset_context or await resolve_channel_asset_target(db, event.channel_id)

    if event.event_type == "escalation_created":
        escalation = await _load_escalation(db, payload.get("escalation_id"))
        node_id = str(payload.get("node_id") or "node")
        return _inbox_row(delivery, event, asset_context, "escalation", str(payload.get("title") or f"Escalation: {node_id}"), str(payload.get("subtitle") or payload.get("reason") or "Needs attention"), escalation_id=escalation.id if escalation else None, run_id=str(payload.get("run_id") or "") or None, due_at=escalation.timeout_at if escalation else None, status=escalation.status if escalation else ("read" if delivery.read_at else "new"))
    if event.event_type == "mentioned_message":
        return _inbox_row(delivery, event, asset_context, "mentioned_message", str(payload.get("title") or "Mentioned in channel"), str(payload.get("subtitle") or ""), run_id=message_run_id, message_id=str(payload.get("message_id") or "") or None)
    if event.event_type == "message_posted":
        title = str(payload.get("title") or f"New message in {payload.get('channel_name') or 'channel'}")
        return _inbox_row(delivery, event, asset_context, "message_posted", title, str(payload.get("subtitle") or payload.get("message_preview") or ""), run_id=message_run_id, message_id=str(payload.get("message_id") or "") or None)
    if event.event_type == "task_assigned":
        return _inbox_row(
            delivery,
            event,
            asset_context,
            "task_assigned",
            str(payload.get("title") or "Task assigned"),
            str(payload.get("subtitle") or payload.get("message_preview") or ""),
            run_id=str(payload.get("run_id") or "") or message_run_id,
            message_id=str(payload.get("message_id") or "") or None,
        )
    if event.event_type in {"run_failed", "run_completed"}:
        return _inbox_row(delivery, event, asset_context, "run_event", str(payload.get("title") or event.event_type.replace("_", " ")), str(payload.get("subtitle") or ""), run_id=str(payload.get("run_id") or "") or None)
    return None

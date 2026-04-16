from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from modules.workflows.backend.runs.escalations_models import Escalation

from ..channels_models import ChannelEvent, ChannelMessage
from ..notifications_models import EventDelivery


def _inbox_row(
    delivery: EventDelivery,
    event: ChannelEvent,
    asset_context: dict[str, str | None],
    item_type: str,
    title: str,
    subtitle: str,
    *,
    status: str | None = None,
    run_id: str | None = None,
    escalation_id: UUID | None = None,
    message_id: str | None = None,
    due_at=None,
) -> dict:
    return {
        "id": f"delivery:{delivery.id}",
        "item_type": item_type,
        "delivery_id": str(delivery.id),
        "title": title,
        "subtitle": subtitle,
        "status": status or ("read" if delivery.read_at else "new"),
        "run_id": run_id,
        "channel_id": str(event.channel_id),
        "escalation_id": escalation_id,
        "proposal_id": None,
        "message_id": message_id,
        **asset_context,
        "due_at": due_at,
        "created_at": delivery.sent_at,
        "unread": delivery.read_at is None,
        "archived_at": delivery.archived_at,
    }


async def _load_event_message(db: AsyncSession, event: ChannelEvent) -> ChannelMessage | None:
    if event.source_type != "message" or not event.source_id:
        return None
    try:
        return await db.get(ChannelMessage, UUID(str(event.source_id)))
    except ValueError:
        return None


async def _load_escalation(db: AsyncSession, escalation_id_raw) -> Escalation | None:
    if not escalation_id_raw:
        return None
    try:
        return await db.get(Escalation, UUID(str(escalation_id_raw)))
    except ValueError:
        return None

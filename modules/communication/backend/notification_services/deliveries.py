from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import workspaces as core_workspaces
from libs.auth.backend.models import User
from libs.participants import parse_participant_id

from ..channels_models import ChannelEvent
from ..notifications_models import EventDelivery
from .participant_preferences import default_preference_state, get_participant_preference


EMAIL_IMMEDIATE_EVENT_TYPES = {
    "escalation_created",
    "mentioned_message",
    "run_failed",
    "task_assigned",
}
EMAIL_THROTTLE_WINDOW = timedelta(minutes=15)


async def resolve_email_address(db: AsyncSession, participant_id: str, explicit_email: str | None = None) -> str | None:
    if explicit_email:
        return explicit_email.strip() or None
    kind, raw_id = parse_participant_id(participant_id)
    user: User | None = None
    if kind == "human":
        user = await db.get(User, UUID(raw_id))
    elif kind == "agent":
        member = await core_workspaces.get_member(db, UUID(raw_id))
        if member is not None:
            user = await db.get(User, member.user_id)
    return None if not user else (user.email or "").strip() or None


async def participant_has_active_access(db: AsyncSession, workspace_id: UUID, participant_id: str) -> bool:
    kind, raw_id = parse_participant_id(participant_id)
    if kind == "agent":
        return await core_workspaces.has_active_member_access(db, workspace_id, UUID(raw_id))
    if kind == "human":
        return await core_workspaces.has_active_user_membership(db, workspace_id, UUID(raw_id))
    return False


async def resolve_delivery_means(db: AsyncSession, workspace_id: UUID, participant_id: str, event_type: str) -> dict:
    if not await participant_has_active_access(db, workspace_id, participant_id):
        return {"means": [], "email_address": None}
    pref = await get_participant_preference(db, workspace_id, participant_id, event_type)
    means: list[str] = []
    email_address: str | None = None
    if pref:
        if pref.app_enabled:
            means.append("app")
        if pref.email_enabled:
            means.append("email")
            email_address = await resolve_email_address(db, participant_id, pref.email_address)
        if pref.push_enabled:
            means.append("push")
        return {"means": means, "email_address": email_address}

    defaults = default_preference_state(participant_id, event_type)
    if defaults["app_enabled"]:
        means.append("app")
    if defaults["email_enabled"]:
        means.append("email")
    if defaults["push_enabled"]:
        means.append("push")
    return {"means": means, "email_address": None}


async def create_delivery(db: AsyncSession, *, workspace_id: UUID, event_id: UUID, participant_id: str, delivery_mean: str, status: str, detail: str | None = None) -> EventDelivery:
    delivery = EventDelivery(
        workspace_id=workspace_id,
        event_id=event_id,
        participant_id=participant_id,
        delivery_mean=delivery_mean,
        status=status,
        detail=detail,
    )
    db.add(delivery)
    await db.flush()
    return delivery


async def should_send_email_delivery(db: AsyncSession, *, event: ChannelEvent, participant_id: str) -> tuple[bool, str | None]:
    if event.event_type not in EMAIL_IMMEDIATE_EVENT_TYPES:
        return False, f"Email policy does not send immediate mail for {event.event_type}"
    since = datetime.now(timezone.utc) - EMAIL_THROTTLE_WINDOW
    recent = await db.execute(
        select(EventDelivery.id)
        .join(ChannelEvent, ChannelEvent.id == EventDelivery.event_id)
        .where(
            EventDelivery.workspace_id == event.workspace_id,
            EventDelivery.participant_id == participant_id,
            EventDelivery.delivery_mean == "email",
            EventDelivery.status == "sent",
            ChannelEvent.event_type == event.event_type,
            ChannelEvent.channel_id == event.channel_id,
            EventDelivery.sent_at >= since,
        )
        .limit(1)
    )
    if recent.scalar_one_or_none() is not None:
        return False, "Email throttled for this participant, event type, and channel"
    return True, None


async def update_delivery_state(db: AsyncSession, *, workspace_id: UUID, participant_id: str, delivery_id: UUID, read: bool | None = None, archived: bool | None = None) -> EventDelivery | None:
    delivery = await db.get(EventDelivery, delivery_id)
    if delivery is None or delivery.workspace_id != workspace_id or delivery.participant_id != participant_id:
        return None
    now = datetime.now(timezone.utc)
    if read is not None:
        delivery.read_at = now if read else None
    if archived is not None:
        delivery.archived_at = now if archived else None
        if archived and delivery.read_at is None:
            delivery.read_at = now
    await db.commit()
    await db.refresh(delivery)
    return delivery


async def mark_all_app_deliveries_read(db: AsyncSession, *, workspace_id: UUID, participant_id: str) -> int:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        update(EventDelivery)
        .where(
            EventDelivery.workspace_id == workspace_id,
            EventDelivery.participant_id == participant_id,
            EventDelivery.delivery_mean == "app",
            EventDelivery.status == "sent",
            EventDelivery.archived_at.is_(None),
            EventDelivery.read_at.is_(None),
        )
        .values(read_at=now)
    )
    await db.commit()
    return int(result.rowcount or 0)

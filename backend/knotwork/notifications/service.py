from __future__ import annotations

from datetime import datetime, timezone
from datetime import timedelta
from urllib.parse import quote
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.models import User
from knotwork.channels.models import ChannelEvent
from knotwork.config import settings
from knotwork.notifications.models import (
    EventDelivery,
    NotificationLog,
    NotificationPreference,
    ParticipantDeliveryPreference,
)
from knotwork.notifications.schemas import NotificationPreferenceUpdate
from knotwork.participants import parse_participant_id, participant_kind
from knotwork.workspaces.models import Workspace


SUPPORTED_EVENT_TYPES = (
    "escalation_created",
    "task_assigned",
    "mentioned_message",
    "run_failed",
    "run_completed",
    "message_posted",
)

EMAIL_IMMEDIATE_EVENT_TYPES = {
    "escalation_created",
    "mentioned_message",
    "run_failed",
    "task_assigned",
}
EMAIL_THROTTLE_WINDOW = timedelta(minutes=15)


async def get_or_create_preferences(
    db: AsyncSession, workspace_id: UUID
) -> NotificationPreference:
    q = select(NotificationPreference).where(
        NotificationPreference.workspace_id == workspace_id
    )
    result = await db.execute(q)
    prefs = result.scalar_one_or_none()
    if not prefs:
        prefs = NotificationPreference(workspace_id=workspace_id)
        db.add(prefs)
        await db.commit()
        await db.refresh(prefs)
    return prefs


async def update_preferences(
    db: AsyncSession,
    workspace_id: UUID,
    data: NotificationPreferenceUpdate,
) -> NotificationPreference:
    prefs = await get_or_create_preferences(db, workspace_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(prefs, field, value)
    await db.commit()
    await db.refresh(prefs)
    return prefs


async def list_notification_log(
    db: AsyncSession, workspace_id: UUID, limit: int = 50
) -> list[NotificationLog]:
    q = (
        select(NotificationLog)
        .where(NotificationLog.workspace_id == workspace_id)
        .order_by(NotificationLog.sent_at.desc())
        .limit(limit)
    )
    result = await db.execute(q)
    return list(result.scalars())


async def log_notification(
    db: AsyncSession,
    workspace_id: UUID,
    channel: str,
    status: str,
    escalation_id: UUID | None = None,
    detail: str | None = None,
) -> NotificationLog:
    entry = NotificationLog(
        workspace_id=workspace_id,
        escalation_id=escalation_id,
        channel=channel,
        status=status,
        detail=detail,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def get_participant_preference(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
    event_type: str,
) -> ParticipantDeliveryPreference | None:
    result = await db.execute(
        select(ParticipantDeliveryPreference).where(
            ParticipantDeliveryPreference.workspace_id == workspace_id,
            ParticipantDeliveryPreference.participant_id == participant_id,
            ParticipantDeliveryPreference.event_type == event_type,
        )
    )
    return result.scalar_one_or_none()


def default_preference_state(participant_id: str, event_type: str) -> dict[str, bool]:
    app_enabled_defaults = {
        "escalation_created",
        "mentioned_message",
        "message_posted",
        "run_failed",
        "run_completed",
        "task_assigned",
    }
    app_enabled = event_type in app_enabled_defaults
    email_enabled = False
    push_enabled = event_type in SUPPORTED_EVENT_TYPES
    return {
        "app_enabled": app_enabled,
        "email_enabled": email_enabled,
        "push_enabled": push_enabled,
    }


async def list_participant_preferences(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
) -> list[ParticipantDeliveryPreference]:
    result = await db.execute(
        select(ParticipantDeliveryPreference)
        .where(
            ParticipantDeliveryPreference.workspace_id == workspace_id,
            ParticipantDeliveryPreference.participant_id == participant_id,
        )
        .order_by(ParticipantDeliveryPreference.event_type.asc())
    )
    return list(result.scalars())


async def get_or_build_participant_preferences(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
) -> list[dict]:
    existing = {
        pref.event_type: pref
        for pref in await list_participant_preferences(db, workspace_id, participant_id)
    }
    rows: list[dict] = []
    for event_type in SUPPORTED_EVENT_TYPES:
        pref = existing.get(event_type)
        defaults = default_preference_state(participant_id, event_type)
        rows.append(
            {
                "participant_id": participant_id,
                "event_type": event_type,
                "app_enabled": pref.app_enabled if pref else defaults["app_enabled"],
                "email_enabled": pref.email_enabled if pref else defaults["email_enabled"],
                "push_enabled": pref.push_enabled if pref else defaults["push_enabled"],
                "email_address": pref.email_address if pref else None,
            }
        )
    return rows


async def update_participant_preference(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
    event_type: str,
    *,
    app_enabled: bool | None = None,
    email_enabled: bool | None = None,
    push_enabled: bool | None = None,
    email_address: str | None = None,
) -> ParticipantDeliveryPreference:
    pref = await get_participant_preference(db, workspace_id, participant_id, event_type)
    if pref is None:
        defaults = default_preference_state(participant_id, event_type)
        pref = ParticipantDeliveryPreference(
            workspace_id=workspace_id,
            participant_id=participant_id,
            event_type=event_type,
            app_enabled=defaults["app_enabled"],
            email_enabled=defaults["email_enabled"],
            push_enabled=defaults["push_enabled"],
        )
        db.add(pref)
        await db.flush()

    if app_enabled is not None:
        pref.app_enabled = app_enabled
    if email_enabled is not None:
        pref.email_enabled = email_enabled
    if push_enabled is not None:
        pref.push_enabled = push_enabled
    if email_address is not None:
        pref.email_address = email_address.strip() or None

    await db.commit()
    await db.refresh(pref)
    return pref


async def resolve_email_address(
    db: AsyncSession,
    participant_id: str,
    explicit_email: str | None = None,
) -> str | None:
    if explicit_email:
        return explicit_email.strip() or None
    kind, raw_id = parse_participant_id(participant_id)
    user: User | None = None
    if kind == "human":
        user = await db.get(User, UUID(raw_id))
    elif kind == "agent":
        from knotwork.workspaces.models import WorkspaceMember

        member = await db.get(WorkspaceMember, UUID(raw_id))
        if member is not None:
            user = await db.get(User, member.user_id)
    if not user:
        return None
    return (user.email or "").strip() or None


async def resolve_delivery_means(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
    event_type: str,
) -> dict:
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


async def create_delivery(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    event_id: UUID,
    participant_id: str,
    delivery_mean: str,
    status: str,
    detail: str | None = None,
) -> EventDelivery:
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


async def should_send_email_delivery(
    db: AsyncSession,
    *,
    event: ChannelEvent,
    participant_id: str,
) -> tuple[bool, str | None]:
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


async def update_delivery_state(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    participant_id: str,
    delivery_id: UUID,
    read: bool | None = None,
    archived: bool | None = None,
) -> EventDelivery | None:
    delivery = await db.get(EventDelivery, delivery_id)
    if delivery is None:
        return None
    if delivery.workspace_id != workspace_id or delivery.participant_id != participant_id:
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


async def mark_all_app_deliveries_read(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    participant_id: str,
) -> int:
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


def _event_email_subject(event: ChannelEvent) -> str:
    if event.event_type == "escalation_created":
        return "[Knotwork] Escalation requires attention"
    if event.event_type == "mentioned_message":
        return "[Knotwork] You were mentioned"
    return "[Knotwork] Notification"


def _event_email_body(event: ChannelEvent) -> str:
    payload = event.payload or {}
    title = str(payload.get("title") or event.event_type.replace("_", " "))
    subtitle = str(payload.get("subtitle") or "").strip()
    channel_name = str(payload.get("channel_name") or "").strip()
    run_id = str(payload.get("run_id") or "").strip()
    link = ""
    if run_id:
        link = f"{settings.normalized_frontend_url}/runs/{quote(run_id)}"
    else:
        channel_id = str(event.channel_id or "").strip()
        if channel_id:
            link = f"{settings.normalized_frontend_url}/channels/{quote(channel_id)}"
    channel_line = f"Channel: {channel_name}\n" if channel_name else ""
    detail_line = f"{subtitle}\n" if subtitle else ""
    link_line = f"Open: {link}\n" if link else "Open Knotwork to review.\n"
    return f"{title}\n{detail_line}{channel_line}\n{link_line}"


async def deliver_event_to_participant(
    db: AsyncSession,
    *,
    event: ChannelEvent,
    participant_id: str,
) -> list[EventDelivery]:
    resolved = await resolve_delivery_means(db, event.workspace_id, participant_id, event.event_type)
    means = resolved["means"] or []
    email_address = resolved["email_address"]

    deliveries: list[EventDelivery] = []
    if not means:
        return deliveries

    for mean in means:
        if mean == "app":
            deliveries.append(
                await create_delivery(
                    db,
                    workspace_id=event.workspace_id,
                    event_id=event.id,
                    participant_id=participant_id,
                    delivery_mean="app",
                    status="sent",
                )
            )
            continue

        if mean == "email":
            allowed, reason = await should_send_email_delivery(
                db,
                event=event,
                participant_id=participant_id,
            )
            if not allowed:
                deliveries.append(
                    await create_delivery(
                        db,
                        workspace_id=event.workspace_id,
                        event_id=event.id,
                        participant_id=participant_id,
                        delivery_mean="email",
                        status="skipped",
                        detail=reason,
                    )
                )
                continue
            workspace = await db.get(Workspace, event.workspace_id)
            resend_api_key = (workspace.resend_api_key or "").strip() if workspace else ""
            email_from = (workspace.email_from or "").strip() if workspace else ""
            if not resend_api_key or not email_from:
                deliveries.append(
                    await create_delivery(
                        db,
                        workspace_id=event.workspace_id,
                        event_id=event.id,
                        participant_id=participant_id,
                        delivery_mean="email",
                        status="skipped",
                        detail="Workspace email delivery is not configured",
                    )
                )
                continue
            if not email_address:
                deliveries.append(
                    await create_delivery(
                        db,
                        workspace_id=event.workspace_id,
                        event_id=event.id,
                        participant_id=participant_id,
                        delivery_mean="email",
                        status="skipped",
                        detail="No email address configured for participant",
                    )
                )
                continue

            from knotwork.notifications.channels.email import send as email_send

            try:
                await email_send(
                    to_address=email_address,
                    subject=_event_email_subject(event),
                    body=_event_email_body(event),
                    from_address=email_from,
                    api_key=resend_api_key,
                )
                deliveries.append(
                    await create_delivery(
                        db,
                        workspace_id=event.workspace_id,
                        event_id=event.id,
                        participant_id=participant_id,
                        delivery_mean="email",
                        status="sent",
                    )
                )
            except Exception as exc:
                deliveries.append(
                    await create_delivery(
                        db,
                        workspace_id=event.workspace_id,
                        event_id=event.id,
                        participant_id=participant_id,
                        delivery_mean="email",
                        status="failed",
                        detail=str(exc),
                    )
                )
            continue

        if mean == "push":
            deliveries.append(
                await create_delivery(
                    db,
                    workspace_id=event.workspace_id,
                    event_id=event.id,
                    participant_id=participant_id,
                    delivery_mean="push",
                    status="skipped",
                    detail="Push transport is client-side; Knotwork records the preference and delivery row but does not dispatch push traffic itself",
                )
            )

    return deliveries

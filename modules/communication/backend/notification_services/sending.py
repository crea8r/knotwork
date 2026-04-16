from __future__ import annotations

from urllib.parse import quote

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import workspaces as core_workspaces
from libs.config import settings

from ..channels_models import ChannelEvent
from ..notifications_models import EventDelivery
from .deliveries import create_delivery, resolve_delivery_means, should_send_email_delivery


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
    link = f"{settings.normalized_frontend_url}/runs/{quote(run_id)}" if run_id else ""
    if not link:
        channel_id = str(event.channel_id or "").strip()
        if channel_id:
            link = f"{settings.normalized_frontend_url}/channels/{quote(channel_id)}"
    return f"{title}\n{subtitle + chr(10) if subtitle else ''}{f'Channel: {channel_name}\\n' if channel_name else ''}\n{f'Open: {link}\\n' if link else 'Open Knotwork to review.\\n'}"


async def deliver_event_to_participant(db: AsyncSession, *, event: ChannelEvent, participant_id: str) -> list[EventDelivery]:
    resolved = await resolve_delivery_means(db, event.workspace_id, participant_id, event.event_type)
    means = resolved["means"] or []
    email_address = resolved["email_address"]
    deliveries: list[EventDelivery] = []
    if not means:
        return deliveries

    for mean in means:
        if mean == "app":
            deliveries.append(await create_delivery(db, workspace_id=event.workspace_id, event_id=event.id, participant_id=participant_id, delivery_mean="app", status="sent"))
        elif mean == "email":
            deliveries.append(await _deliver_email(db, event=event, participant_id=participant_id, email_address=email_address))
        elif mean == "push":
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


async def _deliver_email(db: AsyncSession, *, event: ChannelEvent, participant_id: str, email_address: str | None) -> EventDelivery:
    allowed, reason = await should_send_email_delivery(db, event=event, participant_id=participant_id)
    if not allowed:
        return await create_delivery(db, workspace_id=event.workspace_id, event_id=event.id, participant_id=participant_id, delivery_mean="email", status="skipped", detail=reason)

    workspace_email = await core_workspaces.get_workspace_email_config(db, event.workspace_id)
    resend_api_key = workspace_email["resend_api_key"] or ""
    email_from = workspace_email["email_from"] or ""
    if not resend_api_key or not email_from:
        return await create_delivery(db, workspace_id=event.workspace_id, event_id=event.id, participant_id=participant_id, delivery_mean="email", status="skipped", detail="Workspace email delivery is not configured")
    if not email_address:
        return await create_delivery(db, workspace_id=event.workspace_id, event_id=event.id, participant_id=participant_id, delivery_mean="email", status="skipped", detail="No email address configured for participant")

    from modules.communication.backend.notification_channels.email import send as email_send

    try:
        await email_send(to_address=email_address, subject=_event_email_subject(event), body=_event_email_body(event), from_address=email_from, api_key=resend_api_key)
        return await create_delivery(db, workspace_id=event.workspace_id, event_id=event.id, participant_id=participant_id, delivery_mean="email", status="sent")
    except Exception as exc:
        return await create_delivery(db, workspace_id=event.workspace_id, event_id=event.id, participant_id=participant_id, delivery_mean="email", status="failed", detail=str(exc))

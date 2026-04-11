"""
Notification dispatcher — routes escalation alerts to all enabled channels.

Called after an escalation is created. Loads workspace preferences, sends
to each configured channel, and logs every attempt to NotificationLog.
Failures in one channel do not block delivery to the others.
"""
from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def dispatch(
    escalation_id: str,
    workspace_id: str,
    db: AsyncSession,
    message: str = "",
) -> None:
    """Send notifications to all channels configured for the workspace."""
    from libs.config import settings

    from .notification_channels.email import send as email_send
    from .notification_channels.telegram import send as tg_send
    from .notification_channels.whatsapp import send as wa_send
    from .notifications_service import get_or_create_preferences, log_notification

    ws_id = UUID(workspace_id)
    esc_id = UUID(escalation_id)

    if not message:
        message = (
            f"⚠️ Escalation requires your attention.\n"
            f"ID: {escalation_id}\n"
            f"Open Knotwork to review and resolve."
        )

    prefs = await get_or_create_preferences(db, ws_id)

    if prefs.email_enabled and prefs.email_address:
        try:
            await email_send(
                to_address=prefs.email_address,
                subject="[Knotwork] Escalation requires attention",
                body=message,
                from_address=settings.email_from,
            )
            await log_notification(db, ws_id, "email", "sent", esc_id)
        except Exception as exc:
            logger.error("Email notification failed: %s", exc)
            await log_notification(db, ws_id, "email", "failed", esc_id, str(exc))

    if prefs.telegram_enabled and prefs.telegram_chat_id and settings.telegram_bot_token:
        try:
            await tg_send(prefs.telegram_chat_id, message, settings.telegram_bot_token)
            await log_notification(db, ws_id, "telegram", "sent", esc_id)
        except Exception as exc:
            logger.error("Telegram notification failed: %s", exc)
            await log_notification(db, ws_id, "telegram", "failed", esc_id, str(exc))

    if prefs.whatsapp_enabled and prefs.whatsapp_number:
        try:
            deep_link = await wa_send(prefs.whatsapp_number, message)
            await log_notification(db, ws_id, "whatsapp", "sent", esc_id, deep_link)
        except Exception as exc:
            logger.error("WhatsApp notification failed: %s", exc)
            await log_notification(db, ws_id, "whatsapp", "failed", esc_id, str(exc))

    if not (prefs.email_enabled or prefs.telegram_enabled or prefs.whatsapp_enabled):
        logger.debug("No notification channels enabled for workspace %s", workspace_id)

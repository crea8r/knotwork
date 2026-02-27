"""
Notification dispatcher for escalation alerts.

Routes outbound notifications to one or more channels based on the operator's
preferences stored in the database.  Channel-specific sender modules are
imported lazily to avoid loading heavy dependencies (e.g. Telegram bot SDK)
when a channel is not configured.

Supported channels
------------------
  - ``"email"``     -- via ``knotwork.notifications.channels.email``
  - ``"telegram"``  -- via ``knotwork.notifications.channels.telegram``
  - ``"whatsapp"``  -- via ``knotwork.notifications.channels.whatsapp``
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession


async def dispatch(
    escalation_id: str,
    channels: list[str],
    db: AsyncSession,
) -> None:
    """
    Send escalation notifications across the requested channels.

    For each channel in ``channels``:
      1. Dynamically import the corresponding sender module.
      2. Load the operator's channel-specific preferences (API keys, recipient
         addresses, etc.) from the database.
      3. Call the sender's ``send()`` coroutine with the escalation details.

    Failures in individual channels are logged but do not prevent delivery to
    remaining channels.

    Args:
        escalation_id: UUID of the ``Escalation`` record that triggered
                       this notification.
        channels:      Ordered list of channel names to notify, e.g.
                       ``["email", "telegram"]``.
        db:            Active async SQLAlchemy session for loading preferences.

    Raises:
        NotImplementedError: Always — implementation pending.
    """
    raise NotImplementedError

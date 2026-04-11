"""WhatsApp channel — Phase 1: wa.me deep link.

Phase 1 generates a clickable link and logs it. No direct API send.
Phase 2 (post-S9) will use the WhatsApp Business API.
"""
from __future__ import annotations

import logging
import urllib.parse

logger = logging.getLogger(__name__)


def make_deep_link(phone_number: str, message: str) -> str:
    """Return a wa.me URL with pre-filled message text."""
    encoded = urllib.parse.quote(message)
    # Strip any non-digit prefix characters from phone number
    number = phone_number.lstrip("+").replace(" ", "")
    return f"https://wa.me/{number}?text={encoded}"


async def send(phone_number: str, message: str) -> str:
    """Phase 1: log and return the wa.me deep link (no direct API call)."""
    link = make_deep_link(phone_number, message)
    logger.info("WhatsApp deep-link for %s: %s", phone_number, link)
    return link

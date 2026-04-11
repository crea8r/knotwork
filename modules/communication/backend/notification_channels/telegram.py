"""Telegram Bot API channel sender."""
from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

_TELEGRAM_API = "https://api.telegram.org"


async def send(chat_id: str, message: str, bot_token: str) -> None:
    """Send a message to a Telegram chat via Bot API."""
    url = f"{_TELEGRAM_API}/bot{bot_token}/sendMessage"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            url,
            json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"},
        )
    if not resp.is_success:
        raise RuntimeError(f"Telegram API error {resp.status_code}: {resp.text[:200]}")
    logger.info("Telegram message sent to chat_id=%s", chat_id)

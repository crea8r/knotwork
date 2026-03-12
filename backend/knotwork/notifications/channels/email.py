"""Resend email channel sender (https://resend.com)."""
from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

_RESEND_API_URL = "https://api.resend.com/emails"


async def send(
    to_address: str,
    subject: str,
    body: str,
    from_address: str = "noreply@knotwork.io",
) -> None:
    """Send a plain-text email via the Resend API.

    Reads RESEND_API from settings (env var RESEND_API).
    Raises on non-2xx responses so callers can decide whether to swallow the error.
    """
    from knotwork.config import settings

    api_key = settings.resend_api
    if not api_key:
        logger.warning(
            "EMAIL SKIPPED — RESEND_API env var is not set. "
            "Would have sent: to=%s subject=%r",
            to_address,
            subject,
        )
        return

    logger.debug(
        "EMAIL sending via Resend: to=%s from=%s subject=%r",
        to_address,
        from_address,
        subject,
    )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                _RESEND_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": from_address,
                    "to": [to_address],
                    "subject": subject,
                    "text": body,
                },
            )
    except httpx.TimeoutException:
        logger.error("EMAIL FAILED — Resend API timed out sending to %s", to_address)
        raise
    except httpx.RequestError as exc:
        logger.error("EMAIL FAILED — network error sending to %s: %s", to_address, exc)
        raise

    if resp.status_code >= 400:
        logger.error(
            "EMAIL FAILED — Resend API returned %s for %s: %s",
            resp.status_code,
            to_address,
            resp.text,
        )
        resp.raise_for_status()

    email_id = resp.json().get("id", "?")
    logger.info("EMAIL SENT — to=%s id=%s", to_address, email_id)

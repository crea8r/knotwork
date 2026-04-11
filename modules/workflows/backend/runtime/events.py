"""
Runtime events: publish run/node status events to Redis for WebSocket broadcasting.

Workers call publish_event(); the WebSocket endpoint subscribes to run:{run_id}.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)


async def publish_event(run_id: str, event: dict) -> None:
    """Publish a JSON event to Redis channel ``run:{run_id}``. Best-effort."""
    try:
        import redis.asyncio as aioredis  # type: ignore[import]

        from libs.config import settings

        r = aioredis.from_url(settings.redis_url)
        await r.publish(f"run:{run_id}", json.dumps(event))
        await r.aclose()
    except Exception as exc:
        logger.debug("publish_event skipped for run %s: %s", run_id, exc)

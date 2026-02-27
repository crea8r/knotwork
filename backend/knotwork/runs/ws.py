"""
WebSocket endpoint for real-time run event streaming.

Clients connect to /api/v1/ws/runs/{run_id} and receive JSON events published
by the worker to the Redis channel ``run:{run_id}``.

Events pushed to client:
  {"type": "run_started", "run_id": "..."}
  {"type": "run_status_changed", "status": "completed"|"failed"|"stopped"|"paused"}
  {"type": "node_completed", "node_id": "...", "status": "...", "confidence": 0.95}
  {"type": "escalation_created", "escalation_id": "...", "node_id": "..."}
  {"type": "escalation_resolved", "escalation_id": "...", "resolution": "..."}
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

ws_router = APIRouter(tags=["websocket"])

_TERMINAL_STATUSES = {"completed", "failed", "stopped"}


@ws_router.websocket("/ws/runs/{run_id}")
async def run_events(websocket: WebSocket, run_id: str) -> None:
    await websocket.accept()
    try:
        await _stream_events(websocket, run_id)
    except WebSocketDisconnect:
        logger.debug("WS client disconnected from run %s", run_id)
    except Exception as exc:
        logger.warning("WS error for run %s: %s", run_id, exc)
        await websocket.close(1011)


async def _stream_events(websocket: WebSocket, run_id: str) -> None:
    """Subscribe to Redis pub/sub and forward events until terminal or disconnect."""
    import json

    try:
        import redis.asyncio as aioredis  # type: ignore[import]
        from knotwork.config import settings

        r = aioredis.from_url(settings.redis_url)
        pubsub = r.pubsub()
        await pubsub.subscribe(f"run:{run_id}")
    except Exception as exc:
        logger.warning("Redis unavailable for run WS %s: %s", run_id, exc)
        await websocket.send_json({"type": "error", "message": "event stream unavailable"})
        return

    try:
        while True:
            # Poll Redis with a short timeout to allow client-disconnect detection
            msg = await asyncio.wait_for(pubsub.get_message(ignore_subscribe_messages=True), timeout=1.0)
            if msg and msg.get("type") == "message":
                data = msg["data"]
                text = data.decode() if isinstance(data, bytes) else data
                await websocket.send_text(text)

                try:
                    event = json.loads(text)
                    if event.get("status") in _TERMINAL_STATUSES:
                        break
                except Exception:
                    pass

            # Check if client is still connected via a no-op receive with timeout
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=0.01)
            except asyncio.TimeoutError:
                pass
            except WebSocketDisconnect:
                break
    finally:
        await pubsub.unsubscribe(f"run:{run_id}")
        await r.aclose()

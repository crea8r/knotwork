"""Built-in generic HTTP request tool."""
from __future__ import annotations

import httpx

from knotwork.tools.builtins import register


@register(
    slug="http.request",
    name="HTTP Request",
    description="Make an HTTP request (GET/POST/PUT/DELETE) to any URL.",
    params=[
        {"name": "url", "type": "str", "required": True},
        {"name": "method", "type": "str", "required": False},
        {"name": "body", "type": "dict", "required": False},
        {"name": "headers", "type": "dict", "required": False},
    ],
)
async def http_request(
    url: str,
    method: str = "GET",
    body: dict | None = None,
    headers: dict | None = None,
) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(
            method.upper(),
            url,
            json=body,
            headers=headers or {},
        )
    return {
        "status_code": resp.status_code,
        "body": resp.text[:4000],
        "headers": dict(resp.headers),
    }

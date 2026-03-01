"""Built-in web tools: web.search and web.fetch."""
from __future__ import annotations

import httpx

from knotwork.tools.builtins import register


@register(
    slug="web.search",
    name="Web Search",
    description="Search the web using DuckDuckGo Instant Answer API.",
    params=[
        {"name": "query", "type": "str", "required": True},
        {"name": "max_results", "type": "int", "required": False},
    ],
)
async def web_search(query: str, max_results: int = 5) -> dict:
    url = "https://api.duckduckgo.com/"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, params={"q": query, "format": "json", "no_html": 1})
        resp.raise_for_status()
        data = resp.json()
    results = []
    for r in data.get("RelatedTopics", [])[:max_results]:
        if isinstance(r, dict) and "Text" in r:
            results.append({"text": r["Text"], "url": r.get("FirstURL", "")})
    return {
        "query": query,
        "results": results,
        "abstract": data.get("Abstract", ""),
    }


@register(
    slug="web.fetch",
    name="Web Fetch",
    description="Fetch the raw text content of a URL.",
    params=[
        {"name": "url", "type": "str", "required": True},
    ],
)
async def web_fetch(url: str) -> dict:
    async with httpx.AsyncClient(
        timeout=15,
        follow_redirects=True,
        headers={"User-Agent": "Knotwork/1.0"},
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    return {
        "url": url,
        "status_code": resp.status_code,
        "content": resp.text[:8000],
    }

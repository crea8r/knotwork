from __future__ import annotations

import html
import re
import unicodedata
from urllib.parse import quote_plus
from urllib.request import Request, urlopen


def _strip_tags(text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", text)).strip()


def _normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9\s]", " ", text.lower())


def _tokenize(text: str) -> list[str]:
    return [t for t in _normalize_text(text).split() if len(t) >= 3]


def _score_result(query: str, title: str, snippet: str, url: str) -> int:
    q_tokens = set(_tokenize(query))
    hay = set(_tokenize(f"{title} {snippet} {url}"))
    overlap = len(q_tokens & hay)
    bonus = 0
    lowered_url = (url or "").lower()
    if "maps.google" in lowered_url or "google.com/maps" in lowered_url:
        bonus += 2
    if "facebook.com" in lowered_url:
        bonus += 1
    return overlap + bonus


def _query_variants(query: str) -> list[str]:
    q = query.strip()
    if not q:
        return []
    parts = [q]
    # Prefer exact-phrase matching and địa chỉ-intent for local businesses.
    parts.append(f"\"{q}\"")
    parts.append(f"\"{q}\" địa chỉ số điện thoại facebook")
    seen: set[str] = set()
    out: list[str] = []
    for item in parts:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _search_duckduckgo(query: str, limit: int) -> list[dict]:
    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; KnotworkBot/1.0; +https://knotwork.local)",
        },
    )
    with urlopen(req, timeout=12) as resp:
        body = resp.read().decode("utf-8", errors="ignore")
    link_re = re.compile(
        r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        flags=re.IGNORECASE | re.DOTALL,
    )
    snippet_re = re.compile(
        r'<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>',
        flags=re.IGNORECASE | re.DOTALL,
    )
    links = link_re.findall(body)
    snippets = snippet_re.findall(body)
    results: list[dict] = []
    for idx, (href, raw_title) in enumerate(links[:limit]):
        snippet = _strip_tags(snippets[idx]) if idx < len(snippets) else ""
        results.append({
            "title": _strip_tags(raw_title),
            "url": href,
            "snippet": snippet,
            "engine": "duckduckgo",
        })
    return results


def _search_bing(query: str, limit: int) -> list[dict]:
    url = f"https://www.bing.com/search?format=rss&q={quote_plus(query)}"
    req = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; KnotworkBot/1.0; +https://knotwork.local)",
            "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        },
    )
    with urlopen(req, timeout=12) as resp:
        body = resp.read().decode("utf-8", errors="ignore")
    item_re = re.compile(r"<item>(.*?)</item>", flags=re.IGNORECASE | re.DOTALL)
    title_re = re.compile(r"<title>(.*?)</title>", flags=re.IGNORECASE | re.DOTALL)
    link_re = re.compile(r"<link>(.*?)</link>", flags=re.IGNORECASE | re.DOTALL)
    desc_re = re.compile(r"<description>(.*?)</description>", flags=re.IGNORECASE | re.DOTALL)
    results: list[dict] = []
    for item in item_re.findall(body)[:limit]:
        title_m = title_re.search(item)
        link_m = link_re.search(item)
        desc_m = desc_re.search(item)
        if not title_m or not link_m:
            continue
        results.append({
            "title": _strip_tags(title_m.group(1)),
            "url": _strip_tags(link_m.group(1)),
            "snippet": _strip_tags(desc_m.group(1) if desc_m else ""),
            "engine": "bing",
        })
    return results


def web_search(query: str, max_results: int = 5) -> dict:
    """Best-effort public web search with DuckDuckGo then Bing fallback."""
    q = (query or "").strip()
    if not q:
        return {"query": q, "results": [], "error": "empty query"}
    limit = max(1, min(int(max_results or 5), 10))
    last_error: str | None = None

    collected: list[dict] = []
    for qv in _query_variants(q):
        try:
            ddg = _search_duckduckgo(qv, limit)
            for r in ddg:
                r["query"] = qv
            collected.extend(ddg)
        except Exception as exc:
            err = f"duckduckgo_failed({qv}): {type(exc).__name__}: {exc}"
            last_error = f"{last_error}; {err}" if last_error else err
        try:
            bing = _search_bing(qv, limit)
            for r in bing:
                r["query"] = qv
            collected.extend(bing)
        except Exception as exc:
            err = f"bing_failed({qv}): {type(exc).__name__}: {exc}"
            last_error = f"{last_error}; {err}" if last_error else err

    if not collected:
        return {"query": q, "results": [], "error": last_error or "no_results"}

    dedup: dict[str, dict] = {}
    for r in collected:
        url = (r.get("url") or "").strip()
        if not url:
            continue
        score = _score_result(q, str(r.get("title", "")), str(r.get("snippet", "")), url)
        cand = {**r, "score": score}
        prev = dedup.get(url)
        if prev is None or int(cand["score"]) > int(prev.get("score", -1)):
            dedup[url] = cand

    ranked = sorted(dedup.values(), key=lambda x: int(x.get("score", 0)), reverse=True)
    return {"query": q, "results": ranked[:limit]}

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class BuiltinTool:
    slug: str
    name: str
    category: str
    description: str
    parameters: list[dict[str, Any]]


_BUILTINS: dict[str, BuiltinTool] = {
    "web.search": BuiltinTool(
        slug="web.search",
        name="Web Search",
        category="builtin",
        description="Search the web and return a lightweight JSON response.",
        parameters=[{"name": "query", "type": "string", "required": True}],
    ),
    "web.fetch": BuiltinTool(
        slug="web.fetch",
        name="Web Fetch",
        category="builtin",
        description="Fetch a URL and return response metadata and a text preview.",
        parameters=[{"name": "url", "type": "string", "required": True}],
    ),
    "http.request": BuiltinTool(
        slug="http.request",
        name="HTTP Request",
        category="builtin",
        description="Execute a generic HTTP request.",
        parameters=[
            {"name": "url", "type": "string", "required": True},
            {"name": "method", "type": "string", "required": False},
            {"name": "headers", "type": "object", "required": False},
            {"name": "body", "type": "object", "required": False},
        ],
    ),
    "calc": BuiltinTool(
        slug="calc",
        name="Calculator",
        category="builtin",
        description="Evaluate a safe arithmetic expression.",
        parameters=[{"name": "expression", "type": "string", "required": True}],
    ),
}

_ALLOWED_BINOPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.Pow: lambda a, b: a**b,
    ast.Mod: lambda a, b: a % b,
}
_ALLOWED_UNARYOPS = {
    ast.UAdd: lambda a: +a,
    ast.USub: lambda a: -a,
}


def list_builtins() -> list[BuiltinTool]:
    return list(_BUILTINS.values())


async def execute_builtin(slug: str, input_data: dict[str, Any]) -> dict[str, Any]:
    if slug == "calc":
        return await calc(str(input_data.get("expression", "")))
    if slug == "web.fetch":
        return await _web_fetch(str(input_data.get("url", "")))
    if slug == "web.search":
        return await _web_search(str(input_data.get("query", "")))
    if slug == "http.request":
        return await _http_request(input_data)
    raise ValueError(f"Unknown builtin slug: {slug}")


def _eval_expr(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_expr(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.BinOp) and type(node.op) in _ALLOWED_BINOPS:
        return _ALLOWED_BINOPS[type(node.op)](_eval_expr(node.left), _eval_expr(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _ALLOWED_UNARYOPS:
        return _ALLOWED_UNARYOPS[type(node.op)](_eval_expr(node.operand))
    raise ValueError("Unsupported expression")


async def calc(expression: str) -> dict[str, float]:
    parsed = ast.parse(expression, mode="eval")
    return {"result": _eval_expr(parsed)}


async def _web_fetch(url: str) -> dict[str, Any]:
    if not url:
        raise ValueError("Missing url")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(url)
        response.raise_for_status()
    return {
        "status_code": response.status_code,
        "content_type": response.headers.get("content-type", ""),
        "body": response.text[:4000],
    }


async def _web_search(query: str) -> dict[str, Any]:
    if not query:
        raise ValueError("Missing query")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
        )
        response.raise_for_status()
    payload = response.json()
    return {
        "heading": payload.get("Heading", ""),
        "abstract": payload.get("AbstractText", ""),
        "related_topics": payload.get("RelatedTopics", [])[:5],
    }


async def _http_request(input_data: dict[str, Any]) -> dict[str, Any]:
    url = str(input_data.get("url", ""))
    if not url:
        raise ValueError("Missing url")
    method = str(input_data.get("method", "GET")).upper()
    headers = input_data.get("headers") or {}
    body = input_data.get("body")
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.request(method, url, headers=headers, json=body)
        response.raise_for_status()
    return {
        "status_code": response.status_code,
        "body": response.text[:4000],
    }


__all__ = ["BuiltinTool", "calc", "execute_builtin", "list_builtins"]


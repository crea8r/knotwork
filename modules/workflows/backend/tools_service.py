from __future__ import annotations

import time
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .tools_models import Tool
from .tools_schemas import ToolCreate, ToolUpdate, ToolTestResponse


async def list_tools(db: AsyncSession, workspace_id: UUID) -> list[Tool]:
    q = select(Tool).where(Tool.workspace_id == workspace_id).order_by(Tool.created_at.desc())
    result = await db.execute(q)
    return list(result.scalars())


async def create_tool(db: AsyncSession, workspace_id: UUID, data: ToolCreate) -> Tool:
    tool = Tool(
        workspace_id=workspace_id,
        name=data.name,
        slug=data.slug,
        category=data.category,
        scope=data.scope,
        definition=data.definition,
    )
    db.add(tool)
    await db.commit()
    await db.refresh(tool)
    return tool


async def get_tool(db: AsyncSession, workspace_id: UUID, tool_id: UUID) -> Tool | None:
    tool = await db.get(Tool, tool_id)
    if tool and tool.workspace_id == workspace_id:
        return tool
    return None


async def update_tool(
    db: AsyncSession, workspace_id: UUID, tool_id: UUID, data: ToolUpdate
) -> Tool | None:
    tool = await get_tool(db, workspace_id, tool_id)
    if not tool:
        return None
    if data.name is not None:
        tool.name = data.name
    if data.definition is not None:
        tool.definition = data.definition
    await db.commit()
    await db.refresh(tool)
    return tool


async def delete_tool(db: AsyncSession, workspace_id: UUID, tool_id: UUID) -> bool:
    tool = await get_tool(db, workspace_id, tool_id)
    if not tool:
        return False
    await db.delete(tool)
    await db.commit()
    return True


async def execute_tool(tool: Tool, input_data: dict) -> ToolTestResponse:
    """Invoke a tool (builtin or HTTP) and return the result."""
    from .tools_builtins import execute_builtin

    start = time.monotonic()
    try:
        if tool.category == "builtin":
            output = await execute_builtin(tool.slug, input_data)
        elif tool.category == "http":
            output = await _execute_http(tool.definition, input_data)
        else:
            output = {"error": f"category '{tool.category}' is not directly executable"}
        return ToolTestResponse(output=output, duration_ms=(time.monotonic() - start) * 1000)
    except Exception as exc:
        return ToolTestResponse(
            output={}, error=str(exc), duration_ms=(time.monotonic() - start) * 1000
        )


async def _execute_http(definition: dict, input_data: dict) -> dict:
    """Execute an HTTP tool defined by its definition dict."""
    import httpx

    method = definition.get("method", "GET").upper()
    url = definition.get("url", "")
    headers = definition.get("headers", {})
    for k, v in input_data.items():
        url = url.replace(f"{{{k}}}", str(v))
    async with httpx.AsyncClient(timeout=30) as client:
        if method == "GET":
            resp = await client.get(url, headers=headers)
        else:
            resp = await client.request(method, url, headers=headers, json=input_data)
        resp.raise_for_status()
    return {"status_code": resp.status_code, "body": resp.text[:4000]}

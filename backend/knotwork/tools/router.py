from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.tools import service
from knotwork.tools.schemas import (
    BuiltinToolInfo,
    ToolCreate,
    ToolResponse,
    ToolTestRequest,
    ToolTestResponse,
    ToolUpdate,
)

router = APIRouter(prefix="/workspaces", tags=["tools"])


@router.get("/{workspace_id}/tools/builtins", response_model=list[BuiltinToolInfo])
async def list_builtin_tools(workspace_id: str):
    from knotwork.tools.builtins import list_builtins
    return list_builtins()


@router.post("/{workspace_id}/tools/builtins/{slug}/test", response_model=ToolTestResponse)
async def test_builtin_tool(workspace_id: str, slug: str, data: ToolTestRequest):
    """Test a built-in tool by slug. Calls execute_builtin() directly."""
    import time
    from knotwork.tools.builtins import execute_builtin
    start = time.monotonic()
    try:
        output = await execute_builtin(slug, data.input or {})
        duration_ms = int((time.monotonic() - start) * 1000)
        return ToolTestResponse(output=output, error=None, duration_ms=duration_ms)
    except Exception as exc:
        duration_ms = int((time.monotonic() - start) * 1000)
        return ToolTestResponse(output={}, error=str(exc), duration_ms=duration_ms)


@router.get("/{workspace_id}/tools", response_model=list[ToolResponse])
async def list_tools(workspace_id: str, db: AsyncSession = Depends(get_db)):
    return await service.list_tools(db, UUID(workspace_id))


@router.post(
    "/{workspace_id}/tools",
    response_model=ToolResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_tool(
    workspace_id: str, data: ToolCreate, db: AsyncSession = Depends(get_db)
):
    return await service.create_tool(db, UUID(workspace_id), data)


@router.get("/{workspace_id}/tools/{tool_id}", response_model=ToolResponse)
async def get_tool(workspace_id: str, tool_id: str, db: AsyncSession = Depends(get_db)):
    tool = await service.get_tool(db, UUID(workspace_id), UUID(tool_id))
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    return tool


@router.patch("/{workspace_id}/tools/{tool_id}", response_model=ToolResponse)
async def update_tool(
    workspace_id: str,
    tool_id: str,
    data: ToolUpdate,
    db: AsyncSession = Depends(get_db),
):
    tool = await service.update_tool(db, UUID(workspace_id), UUID(tool_id), data)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    return tool


@router.delete("/{workspace_id}/tools/{tool_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tool(workspace_id: str, tool_id: str, db: AsyncSession = Depends(get_db)):
    deleted = await service.delete_tool(db, UUID(workspace_id), UUID(tool_id))
    if not deleted:
        raise HTTPException(status_code=404, detail="Tool not found")


@router.post("/{workspace_id}/tools/{tool_id}/test", response_model=ToolTestResponse)
async def test_tool(
    workspace_id: str,
    tool_id: str,
    data: ToolTestRequest,
    db: AsyncSession = Depends(get_db),
):
    tool = await service.get_tool(db, UUID(workspace_id), UUID(tool_id))
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    return await service.execute_tool(tool, data.input)

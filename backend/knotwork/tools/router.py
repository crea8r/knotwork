from fastapi import APIRouter

router = APIRouter(prefix="/workspaces", tags=["tools"])


@router.get("/{workspace_id}/tools")
async def list_tools(workspace_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.post("/{workspace_id}/tools")
async def create_tool(workspace_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.get("/{workspace_id}/tools/{tool_id}")
async def get_tool(workspace_id: str, tool_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.patch("/{workspace_id}/tools/{tool_id}")
async def update_tool(workspace_id: str, tool_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.delete("/{workspace_id}/tools/{tool_id}")
async def delete_tool(workspace_id: str, tool_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.post("/{workspace_id}/tools/{tool_id}/test")
async def test_tool(workspace_id: str, tool_id: str):
    # TODO: implement
    return {"message": "not implemented"}

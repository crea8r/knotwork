from fastapi import APIRouter

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("")
async def list_workspaces():
    # TODO: implement
    return {"message": "not implemented"}


@router.post("")
async def create_workspace():
    # TODO: implement
    return {"message": "not implemented"}


@router.get("/{workspace_id}")
async def get_workspace(workspace_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.patch("/{workspace_id}")
async def update_workspace(workspace_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.get("/{workspace_id}/members")
async def list_workspace_members(workspace_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.post("/{workspace_id}/members")
async def add_workspace_member(workspace_id: str):
    # TODO: implement
    return {"message": "not implemented"}

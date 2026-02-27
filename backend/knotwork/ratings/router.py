from fastapi import APIRouter

router = APIRouter(prefix="/workspaces", tags=["ratings"])


@router.post("/{workspace_id}/runs/{run_id}/nodes/{node_id}/rating")
async def create_rating(workspace_id: str, run_id: str, node_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.get("/{workspace_id}/ratings")
async def list_ratings(workspace_id: str):
    # TODO: implement
    return {"message": "not implemented"}

from fastapi import APIRouter

router = APIRouter(prefix="/workspaces", tags=["escalations"])


@router.get("/{workspace_id}/escalations")
async def list_escalations(workspace_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.get("/{workspace_id}/escalations/{escalation_id}")
async def get_escalation(workspace_id: str, escalation_id: str):
    # TODO: implement
    return {"message": "not implemented"}


@router.post("/{workspace_id}/escalations/{escalation_id}/resolve")
async def resolve_escalation(workspace_id: str, escalation_id: str):
    # TODO: implement
    return {"message": "not implemented"}

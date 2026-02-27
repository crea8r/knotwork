from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.runs import service
from knotwork.runs.schemas import RunCreate, RunNodeStateOut, RunOut

router = APIRouter(prefix="/workspaces", tags=["runs"])


@router.post(
    "/{workspace_id}/graphs/{graph_id}/runs",
    response_model=RunOut,
    status_code=201,
)
async def trigger_run(
    workspace_id: UUID,
    graph_id: UUID,
    data: RunCreate,
    db: AsyncSession = Depends(get_db),
):
    try:
        run = await service.create_run(db, workspace_id, graph_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return RunOut.model_validate(run)


@router.get("/{workspace_id}/runs", response_model=list[RunOut])
async def list_workspace_runs(
    workspace_id: UUID, db: AsyncSession = Depends(get_db)
):
    runs = await service.list_workspace_runs(db, workspace_id)
    return [RunOut.model_validate(r) for r in runs]


@router.get("/{workspace_id}/runs/{run_id}", response_model=RunOut)
async def get_run(
    workspace_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    return RunOut.model_validate(run)


@router.get(
    "/{workspace_id}/runs/{run_id}/nodes",
    response_model=list[RunNodeStateOut],
)
async def list_run_nodes(
    workspace_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    nodes = await service.list_run_node_states(db, run_id)
    return [RunNodeStateOut.model_validate(n) for n in nodes]


@router.post("/{workspace_id}/runs/{run_id}/resume")
async def resume_run(workspace_id: str, run_id: str):
    # TODO: Session 2 — re-enqueue arq task with human response
    return {"message": "not implemented"}


@router.delete("/{workspace_id}/runs/{run_id}")
async def delete_run(workspace_id: str, run_id: str):
    return {"message": "not implemented"}


@router.get("/{workspace_id}/graphs/{graph_id}/runs", response_model=list[RunOut])
async def list_graph_runs(
    workspace_id: UUID, graph_id: UUID, db: AsyncSession = Depends(get_db)
):
    runs = await service.list_workspace_runs(db, workspace_id)
    filtered = [r for r in runs if str(r.graph_id) == str(graph_id)]
    return [RunOut.model_validate(r) for r in filtered]

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.runs import service
from knotwork.runs.schemas import ResumeRun, RunCreate, RunNodeStateOut, RunOut, RunUpdate


router = APIRouter(prefix="/workspaces", tags=["runs"])


@router.post("/{workspace_id}/graphs/{graph_id}/runs", response_model=RunOut, status_code=201)
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
async def list_workspace_runs(workspace_id: UUID, db: AsyncSession = Depends(get_db)):
    rows = await service.list_workspace_runs(db, workspace_id)
    return [RunOut.model_validate(r) for r in rows]


@router.get("/{workspace_id}/runs/{run_id}", response_model=RunOut)
async def get_run(workspace_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db)):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    return RunOut.model_validate(run)


@router.patch("/{workspace_id}/runs/{run_id}", response_model=RunOut)
async def update_run(
    workspace_id: UUID,
    run_id: UUID,
    data: RunUpdate,
    db: AsyncSession = Depends(get_db),
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    try:
        updated = await service.update_run(db, run_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return RunOut.model_validate(updated)


@router.get("/{workspace_id}/runs/{run_id}/nodes", response_model=list[RunNodeStateOut])
async def list_run_nodes(
    workspace_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    nodes = await service.list_run_node_states(db, run_id)
    return [RunNodeStateOut.model_validate(n) for n in nodes]


@router.post("/{workspace_id}/runs/{run_id}/resume")
async def resume_run(
    workspace_id: UUID,
    run_id: UUID,
    data: ResumeRun,
    db: AsyncSession = Depends(get_db),
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    if run.status != "paused":
        raise HTTPException(400, f"Run is not paused (status: {run.status})")
    try:
        from arq import create_pool
        from arq.connections import RedisSettings
        from knotwork.config import settings
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("resume_run", run_id=str(run_id), resolution=data.model_dump())
        await redis.aclose()
    except Exception as e:
        raise HTTPException(503, f"Failed to enqueue resume task: {e}")
    return {"status": "resuming", "run_id": str(run_id)}


@router.post("/{workspace_id}/runs/{run_id}/abort", status_code=200)
async def abort_run(
    workspace_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db)
):
    from datetime import datetime, timezone
    from knotwork.runtime.events import publish_event
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    if run.status in ("completed", "failed", "stopped"):
        raise HTTPException(400, f"Run already in terminal state: {run.status}")
    run.status = "stopped"
    run.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await publish_event(str(run_id), {"type": "run_status_changed", "status": "stopped"})
    return {"status": "stopped", "run_id": str(run_id)}


@router.delete("/{workspace_id}/runs/{run_id}", status_code=204)
async def delete_run(
    workspace_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    if run.status not in service.DELETABLE_STATUSES:
        raise HTTPException(400, f"Cannot delete a run with status '{run.status}'")
    await service.delete_run(db, run_id)


@router.post("/{workspace_id}/runs/{run_id}/execute", status_code=200)
async def execute_run_inline(
    workspace_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db)
):
    """Execute a queued/draft run immediately (dev helper — no worker needed)."""
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    if run.status not in ("queued", "draft"):
        raise HTTPException(400, f"Run must be queued or draft (status: {run.status})")
    import asyncio
    from knotwork.runtime.engine import execute_run as _execute_run
    asyncio.create_task(_execute_run(str(run_id)))
    return {"status": "executing", "run_id": str(run_id)}


@router.post("/{workspace_id}/runs/{run_id}/clone", response_model=RunOut, status_code=201)
async def clone_run(
    workspace_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    try:
        draft = await service.clone_run_as_draft(db, run_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return RunOut.model_validate(draft)


@router.get("/{workspace_id}/graphs/{graph_id}/runs", response_model=list[RunOut])
async def list_graph_runs(
    workspace_id: UUID, graph_id: UUID, db: AsyncSession = Depends(get_db)
):
    rows = await service.list_workspace_runs(db, workspace_id)
    return [RunOut.model_validate(r) for r in rows if str(r["graph_id"]) == str(graph_id)]

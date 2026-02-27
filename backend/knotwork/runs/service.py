from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.graphs.service import get_graph, get_latest_version
from knotwork.runs.models import Run, RunNodeState
from knotwork.runs.schemas import RunCreate


async def create_run(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
    data: RunCreate,
    created_by: UUID | None = None,
) -> Run:
    graph = await get_graph(db, graph_id)
    if not graph:
        raise ValueError("Graph not found")

    version = await get_latest_version(db, graph_id)
    if not version:
        raise ValueError("Graph has no versions")

    run = Run(
        workspace_id=workspace_id,
        graph_id=graph_id,
        graph_version_id=version.id,
        input=data.input,
        context_files=data.context_files,
        trigger=data.trigger,
        created_by=created_by,
        status="queued",
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    # Enqueue arq task
    from arq import create_pool
    from arq.connections import RedisSettings
    from knotwork.config import settings
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await redis.enqueue_job("execute_run", run_id=str(run.id))
    await redis.aclose()

    return run


async def get_run(db: AsyncSession, run_id: UUID) -> Run | None:
    return await db.get(Run, run_id)


async def list_run_node_states(db: AsyncSession, run_id: UUID) -> list[RunNodeState]:
    result = await db.execute(
        select(RunNodeState).where(RunNodeState.run_id == run_id)
    )
    return list(result.scalars())


async def list_workspace_runs(db: AsyncSession, workspace_id: UUID) -> list[Run]:
    result = await db.execute(
        select(Run)
        .where(Run.workspace_id == workspace_id)
        .order_by(Run.created_at.desc())
        .limit(50)
    )
    return list(result.scalars())

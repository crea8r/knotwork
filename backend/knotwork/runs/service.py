from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.graphs.service import get_graph, get_latest_version
from knotwork.runs.models import Run, RunNodeState
from knotwork.runs.schemas import RunCreate, RunUpdate

DELETABLE_STATUSES = {"completed", "failed", "stopped", "draft", "queued", "paused"}


async def create_run(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
    data: RunCreate,
    created_by: UUID | None = None,
) -> Run:
    from knotwork.runtime.validation import validate_graph

    graph = await get_graph(db, graph_id)
    if not graph:
        raise ValueError("Graph not found")

    version = await get_latest_version(db, graph_id)
    if not version:
        raise ValueError("Graph has no versions")

    errors = validate_graph(version.definition)
    if errors:
        raise ValueError("; ".join(errors))

    run = Run(
        workspace_id=workspace_id,
        graph_id=graph_id,
        graph_version_id=version.id,
        name=data.name,
        input=data.input,
        context_files=data.context_files,
        trigger=data.trigger,
        created_by=created_by,
        status="queued",
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    from arq import create_pool
    from arq.connections import RedisSettings
    from knotwork.config import settings
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await redis.enqueue_job("execute_run", run_id=str(run.id))
    await redis.aclose()

    return run


async def get_run(db: AsyncSession, run_id: UUID) -> Run | None:
    return await db.get(Run, run_id)


async def update_run(db: AsyncSession, run_id: UUID, data: RunUpdate) -> Run | None:
    run = await db.get(Run, run_id)
    if not run:
        return None
    if data.name is not None:
        run.name = data.name
    if data.input is not None:
        if run.status != "draft":
            raise ValueError("Input can only be changed on draft runs")
        run.input = data.input
    await db.commit()
    await db.refresh(run)
    return run


async def list_run_node_states(db: AsyncSession, run_id: UUID) -> list[RunNodeState]:
    result = await db.execute(
        select(RunNodeState).where(RunNodeState.run_id == run_id)
    )
    return list(result.scalars())


async def list_workspace_runs(db: AsyncSession, workspace_id: UUID) -> list[dict]:
    """Return runs enriched with total_tokens, output_summary, needs_attention."""
    runs_q = await db.execute(
        select(Run)
        .where(Run.workspace_id == workspace_id)
        .order_by(Run.created_at.desc())
        .limit(50)
    )
    runs = list(runs_q.scalars())
    if not runs:
        return []

    run_ids = [r.id for r in runs]

    tok_q = await db.execute(
        select(RunNodeState.run_id, func.sum(RunNodeState.resolved_token_count).label("total"))
        .where(RunNodeState.run_id.in_(run_ids))
        .group_by(RunNodeState.run_id)
    )
    tok_map: dict = {row.run_id: row.total for row in tok_q}

    nodes_q = await db.execute(
        select(RunNodeState)
        .where(RunNodeState.run_id.in_(run_ids), RunNodeState.status == "completed")
        .order_by(RunNodeState.completed_at.desc())
    )
    seen: set = set()
    out_map: dict = {}
    for ns in nodes_q.scalars():
        if ns.run_id not in seen:
            seen.add(ns.run_id)
            if isinstance(ns.output, dict) and isinstance(ns.output.get("text"), str):
                out_map[ns.run_id] = ns.output["text"][:200]

    result = []
    for r in runs:
        result.append({
            **{c.key: getattr(r, c.key) for c in r.__table__.columns},
            "total_tokens": tok_map.get(r.id),
            "output_summary": out_map.get(r.id),
            "needs_attention": r.status == "paused",
        })
    return result


async def clone_run_as_draft(db: AsyncSession, run_id: UUID) -> Run:
    source = await db.get(Run, run_id)
    if not source:
        raise ValueError("Run not found")
    version = await get_latest_version(db, source.graph_id)
    if not version:
        raise ValueError("Graph has no versions")
    draft = Run(
        workspace_id=source.workspace_id,
        graph_id=source.graph_id,
        graph_version_id=version.id,
        input=source.input,
        context_files=source.context_files,
        trigger="manual",
        status="draft",
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return draft


async def delete_run(db: AsyncSession, run_id: UUID) -> None:
    """Hard-delete. Closes open escalations first to avoid FK violations."""
    run = await db.get(Run, run_id)
    if not run:
        return
    from knotwork.escalations.models import Escalation
    escs_q = await db.execute(
        select(Escalation).where(Escalation.run_id == run_id, Escalation.status == "open")
    )
    for esc in escs_q.scalars():
        esc.status = "timed_out"
    await db.flush()
    await db.delete(run)
    await db.commit()

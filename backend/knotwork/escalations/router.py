from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.escalations import service
from knotwork.escalations.schemas import EscalationOut, EscalationResolve
from knotwork.runtime.events import publish_event

router = APIRouter(prefix="/workspaces", tags=["escalations"])


@router.get("/{workspace_id}/escalations", response_model=list[EscalationOut])
async def list_escalations(
    workspace_id: UUID,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_workspace_escalations(db, workspace_id, status=status)


@router.get("/{workspace_id}/escalations/{escalation_id}", response_model=EscalationOut)
async def get_escalation(
    workspace_id: UUID,
    escalation_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    esc = await service.get_escalation(db, escalation_id)
    if not esc or esc.workspace_id != workspace_id:
        raise HTTPException(404, "Escalation not found")
    return EscalationOut.model_validate(esc)


@router.post(
    "/{workspace_id}/escalations/{escalation_id}/resolve",
    response_model=EscalationOut,
)
async def resolve_escalation(
    workspace_id: UUID,
    escalation_id: UUID,
    data: EscalationResolve,
    db: AsyncSession = Depends(get_db),
):
    esc = await service.get_escalation(db, escalation_id)
    if not esc or esc.workspace_id != workspace_id:
        raise HTTPException(404, "Escalation not found")
    if esc.status != "open":
        raise HTTPException(400, "Escalation is not open")
    resolved = await service.resolve_escalation(db, escalation_id, data)

    run_id = str(resolved.run_id)
    await publish_event(run_id, {
        "type": "escalation_resolved",
        "escalation_id": str(resolved.id),
        "resolution": data.resolution,
    })

    if data.resolution != "aborted":
        _enqueue_resume(run_id, data)
    else:
        await _abort_run(db, resolved.run_id)

    return EscalationOut.model_validate(resolved)


def _enqueue_resume(run_id: str, data: EscalationResolve) -> None:
    """Fire-and-forget: enqueue resume_run arq task."""
    import asyncio

    async def _do() -> None:
        try:
            from arq import create_pool
            from arq.connections import RedisSettings

            from knotwork.config import settings

            redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
            await redis.enqueue_job("resume_run", run_id=run_id, resolution=data.model_dump())
            await redis.aclose()
        except Exception:
            pass

    asyncio.ensure_future(_do())


async def _abort_run(db: AsyncSession, run_id: UUID) -> None:
    from knotwork.runs.models import Run

    run = await db.get(Run, run_id)
    if run and run.status in ("paused", "running"):
        run.status = "stopped"
        await db.commit()

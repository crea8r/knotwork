from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db
from modules.workflows.backend.runs.human_review import resolve_run_escalation

from . import escalations_service as service
from .escalations_schemas import EscalationOut, EscalationResolve

router = APIRouter(prefix="/workspaces", tags=["runs"])


@router.get("/{workspace_id}/runs/escalations", response_model=list[EscalationOut])
async def list_escalations(
    workspace_id: UUID,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_workspace_escalations(db, workspace_id, status=status)


@router.get("/{workspace_id}/runs/{run_id}/escalations", response_model=list[EscalationOut])
async def list_run_escalations(
    workspace_id: UUID,
    run_id: str,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_run_escalations(db, workspace_id, run_id, status=status)


@router.get("/{workspace_id}/runs/{run_id}/escalations/{escalation_id}", response_model=EscalationOut)
async def get_escalation(
    workspace_id: UUID,
    run_id: str,
    escalation_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    esc = await service.get_escalation(db, escalation_id)
    if not esc or esc.workspace_id != workspace_id or esc.run_id != run_id:
        raise HTTPException(404, "Escalation not found")
    return EscalationOut.model_validate(esc)


@router.post(
    "/{workspace_id}/runs/{run_id}/escalations/{escalation_id}/resolve",
    response_model=EscalationOut,
)
async def resolve_escalation(
    workspace_id: UUID,
    run_id: str,
    escalation_id: UUID,
    data: EscalationResolve,
    db: AsyncSession = Depends(get_db),
):
    esc = await service.get_escalation(db, escalation_id)
    if not esc or esc.workspace_id != workspace_id or esc.run_id != run_id:
        raise HTTPException(404, "Escalation not found")
    if esc.status != "open":
        raise HTTPException(400, "Escalation is not open")
    try:
        resolved = await resolve_run_escalation(
            db,
            workspace_id=workspace_id,
            escalation_id=escalation_id,
            payload=data,
        )
    except ValueError as exc:
        detail = str(exc)
        if detail == "Escalation not found":
            raise HTTPException(404, detail)
        if detail == "Escalation is not open":
            raise HTTPException(400, detail)
        raise HTTPException(400, detail)

    return EscalationOut.model_validate(resolved)

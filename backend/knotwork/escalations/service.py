from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.escalations.models import Escalation
from knotwork.escalations.schemas import EscalationResolve


async def create_escalation(
    db: AsyncSession,
    *,
    run_id: UUID,
    run_node_state_id: UUID,
    workspace_id: UUID,
    type: str,
    context: dict,
    timeout_hours: int = 24,
) -> Escalation:
    """Insert a new open escalation and return it."""
    timeout_at = datetime.now(timezone.utc) + timedelta(hours=timeout_hours)
    esc = Escalation(
        run_id=run_id,
        run_node_state_id=run_node_state_id,
        workspace_id=workspace_id,
        type=type,
        context=context,
        timeout_at=timeout_at,
    )
    db.add(esc)
    await db.commit()
    await db.refresh(esc)

    # Fire-and-forget notifications (errors logged, never propagated)
    try:
        from knotwork.notifications.dispatcher import dispatch
        await dispatch(str(esc.id), str(workspace_id), db)
    except Exception:
        pass

    return esc


async def get_escalation(db: AsyncSession, escalation_id: UUID) -> Escalation | None:
    return await db.get(Escalation, escalation_id)


async def list_workspace_escalations(
    db: AsyncSession,
    workspace_id: UUID,
    status: str | None = None,
) -> list[Escalation]:
    q = select(Escalation).where(Escalation.workspace_id == workspace_id)
    if status:
        q = q.where(Escalation.status == status)
    q = q.order_by(Escalation.created_at.desc())
    result = await db.execute(q)
    return list(result.scalars())


async def resolve_escalation(
    db: AsyncSession,
    escalation_id: UUID,
    data: EscalationResolve,
) -> Escalation:
    """Mark an escalation as resolved and record the resolution data."""
    esc = await db.get(Escalation, escalation_id)
    if not esc:
        raise ValueError(f"Escalation {escalation_id} not found")
    esc.status = "resolved"
    esc.resolution = data.resolution
    override_output = data.override_output if data.override_output is not None else data.edited_output
    esc.resolution_data = {
        "override_output": override_output,
        "edited_output": override_output,  # backward-compatible key
        "guidance": data.guidance,
    }
    esc.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(esc)
    return esc


async def timeout_open_escalations(db: AsyncSession) -> list[UUID]:
    """
    Set status='timed_out' for escalations past their timeout_at.
    Returns list of affected run_ids for further status updates.
    """
    now = datetime.now(timezone.utc)
    q = select(Escalation).where(
        Escalation.status == "open",
        Escalation.timeout_at <= now,
    )
    result = await db.execute(q)
    escalations = list(result.scalars())
    run_ids = []
    for esc in escalations:
        esc.status = "timed_out"
        run_ids.append(esc.run_id)
    if escalations:
        await db.commit()
    return run_ids

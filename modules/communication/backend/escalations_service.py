from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import channels as core_channels
from libs.participants import list_workspace_participants

from .escalations_models import Escalation
from .escalations_schemas import EscalationResolve

logger = logging.getLogger(__name__)


async def create_escalation(
    db: AsyncSession,
    *,
    run_id: str,
    run_node_state_id: UUID,
    workspace_id: UUID,
    type: str,
    context: dict,
    assigned_to: list[str] | None = None,
    timeout_hours: int = 24,
) -> Escalation:
    """Insert a new open escalation and return it."""
    timeout_at = datetime.now(timezone.utc) + timedelta(hours=timeout_hours)
    recipients = list(assigned_to or context.get("participant_ids") or context.get("assigned_to") or [])
    single_recipient = context.get("participant_id")
    if single_recipient and single_recipient not in recipients:
        recipients.append(str(single_recipient))
    esc = Escalation(
        run_id=run_id,
        run_node_state_id=run_node_state_id,
        workspace_id=workspace_id,
        type=type,
        context=context,
        assigned_to=recipients,
        timeout_at=timeout_at,
    )
    db.add(esc)
    await db.commit()
    await db.refresh(esc)

    try:
        channel_id = await core_channels.resolve_run_channel_id(db, workspace_id, run_id, context)
        if not recipients:
            participants = await list_workspace_participants(db, workspace_id)
            participant_ids = {participant["participant_id"] for participant in participants}
            if channel_id is not None:
                subscriptions = await core_channels.list_channel_subscriptions_for_channel(
                    db,
                    workspace_id,
                    channel_id,
                )
                recipients = [
                    subscription.participant_id
                    for subscription in subscriptions
                    if subscription.unsubscribed_at is None and subscription.participant_id in participant_ids
                ]
            if not recipients:
                recipients = list(participant_ids)

        if channel_id is not None and recipients:
            node_id = str((context or {}).get("node_id") or "node")
            await core_channels.publish_channel_event(
                db,
                workspace_id=workspace_id,
                channel_id=channel_id,
                event_type="escalation_created",
                event_kind="actionable",
                source_type="escalation",
                source_id=str(esc.id),
                actor_type="system",
                actor_name="Knotwork",
                payload={
                    "escalation_id": str(esc.id),
                    "run_id": run_id,
                    "node_id": node_id,
                    "reason": str((context or {}).get("reason") or type),
                    "title": f"Escalation: {node_id}",
                    "subtitle": str((context or {}).get("reason") or type),
                },
                recipient_participant_ids=recipients,
            )
    except Exception:
        logger.exception(
            "Failed to publish escalation channel event",
            extra={
                "run_id": run_id,
                "workspace_id": str(workspace_id),
                "run_node_state_id": str(run_node_state_id),
                "escalation_id": str(esc.id),
                "recipient_count": len(recipients),
            },
        )

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
        "answers": data.answers,
        "next_branch": data.next_branch,
    }
    esc.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(esc)
    return esc


async def timeout_open_escalations(db: AsyncSession) -> list[str]:
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

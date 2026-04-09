from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.escalations import service
from knotwork.escalations.schemas import EscalationOut, EscalationResolve
from knotwork.runtime.events import publish_event

router = APIRouter(prefix="/workspaces", tags=["escalations"])
logger = logging.getLogger(__name__)


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
    normalized_resolution = _normalize_resolution(data.resolution)
    canonical_output = (
        data.override_output if data.override_output is not None else data.edited_output
    )
    # Persist and propagate one canonical resolution vocabulary.
    normalized_data = data.model_copy(update={
        "resolution": normalized_resolution,
        "override_output": canonical_output,
        "edited_output": canonical_output,
    })
    resolved = await service.resolve_escalation(db, escalation_id, normalized_data)

    await _record_decision_event(db, workspace_id, resolved, normalized_data, normalized_resolution)

    run_id = str(resolved.run_id)
    await publish_event(run_id, {
        "type": "escalation_resolved",
        "escalation_id": str(resolved.id),
        "resolution": normalized_resolution,
    })

    if normalized_resolution != "abort_run":
        await _enqueue_resume(run_id, normalized_data)
    else:
        await _abort_run(db, resolved.run_id)

    return EscalationOut.model_validate(resolved)


async def _enqueue_resume(run_id: str, data: EscalationResolve) -> None:
    """
    Resume a paused run after escalation resolution.

    Preferred path: enqueue arq resume_run job.
    Fallback path (dev/reliability): schedule in-process resume task when
    queue dispatch fails, instead of silently leaving the run paused forever.
    """
    import asyncio

    enqueued = False
    try:
        from arq import create_pool
        from arq.connections import RedisSettings

        from knotwork.config import settings

        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        try:
            await redis.enqueue_job(
                "resume_run",
                run_id=run_id,
                resolution=data.model_dump(),
            )
            enqueued = True
        finally:
            await redis.aclose()
    except Exception as exc:
        logger.warning(
            "Failed to enqueue resume_run for run %s; falling back to in-process resume: %s",
            run_id,
            exc,
        )

    if not enqueued:
        from knotwork.runtime.runner import resume_run as _resume_run
        asyncio.create_task(_resume_run(run_id, data.model_dump()))
        return

    # Worker may be down even when enqueue succeeds. Fallback watchdog ensures
    # the run does not stay paused forever in dev/unhealthy environments.
    asyncio.create_task(_resume_if_still_paused(run_id, data.model_dump(), delay_seconds=3.0))


async def _abort_run(db: AsyncSession, run_id: str) -> None:
    from knotwork.public_workflows.service import notify_public_run_aborted
    from knotwork.runs.models import Run

    run = await db.get(Run, run_id)
    if run and run.status in ("paused", "running"):
        run.status = "stopped"
        await db.commit()
        await notify_public_run_aborted(db, run_id)


def _normalize_resolution(value: str) -> str:
    mapping = {
        # Backward-compatible aliases -> canonical
        "approved": "accept_output",
        "guided": "request_revision",
        "edited": "override_output",
        "aborted": "abort_run",
        # Canonical values
        "accept_output": "accept_output",
        "request_revision": "request_revision",
        "override_output": "override_output",
        "abort_run": "abort_run",
    }
    return mapping.get(value, value)


async def _resume_if_still_paused(run_id: str, resolution: dict, delay_seconds: float = 3.0) -> None:
    import asyncio
    from sqlalchemy import select

    from knotwork.database import AsyncSessionLocal
    from knotwork.escalations.models import Escalation
    from knotwork.runs.models import Run
    from knotwork.runtime.runner import resume_run as _resume_run

    await asyncio.sleep(delay_seconds)

    async with AsyncSessionLocal() as db:
        run = await db.get(Run, run_id)
        if not run or run.status != "paused":
            return
        # If a new escalation is already open, resume was consumed and the run
        # is legitimately paused waiting for another human answer.
        open_esc = await db.execute(
            select(Escalation.id).where(
                Escalation.run_id == run_id,
                Escalation.status == "open",
            )
        )

        if open_esc.first() is not None:
            return

    logger.warning(
        "resume_run job for run %s appears unconsumed after %.1fs; falling back in-process",
        run_id,
        delay_seconds,
    )
    await _resume_run(run_id, resolution)


async def _record_decision_event(
    db: AsyncSession,
    workspace_id: UUID,
    esc,
    data: EscalationResolve,
    normalized_resolution: str,
) -> None:
    from knotwork.channels.service import (
        create_decision,
        find_workflow_channel_for_run,
        get_or_create_run_channel,
        create_message,
    )
    from knotwork.channels.schemas import DecisionEventCreate, ChannelMessageCreate

    actor_type = data.actor_type or "human"
    channel_id = data.channel_id
    if channel_id is None:
        channel_id = await find_workflow_channel_for_run(db, esc.run_id)  # type: ignore[attr-defined]
    payload = {
        "guidance": data.guidance,
        "override_output": data.override_output if data.override_output is not None else data.edited_output,
        "answers": data.answers,
        "next_branch": data.next_branch,
    }
    await create_decision(
        db,
        workspace_id=workspace_id,
        channel_id=channel_id,
        data=DecisionEventCreate(
            decision_type=normalized_resolution,
            actor_type=actor_type,
            actor_name=data.actor_name,
            run_id=esc.run_id,  # type: ignore[attr-defined]
            escalation_id=esc.id,  # type: ignore[attr-defined]
            payload=payload,
        ),
    )

    questions = [str(question) for question in ((esc.context or {}).get("questions") or []) if str(question).strip()]
    answers = [str(answer).strip() for answer in (data.answers or []) if str(answer).strip()]
    answer_blocks = [
        f"Q: {question}\nA: {answer}"
        for question, answer in zip(questions, answers)
        if answer
    ]

    response_text = ""
    if normalized_resolution == "request_revision":
        if answer_blocks:
            response_text = "\n\n".join(answer_blocks)
            if data.guidance:
                response_text = f"{response_text}\n\nAdditional context:\n{data.guidance}"
        elif data.guidance:
            response_text = str(data.guidance)
    elif normalized_resolution == "override_output":
        edited = data.override_output if data.override_output is not None else data.edited_output
        if isinstance(edited, dict):
            response_text = str(edited.get("text") or "").strip() or str(edited).strip()
        else:
            response_text = str(edited or "")
    elif normalized_resolution == "accept_output":
        edited = data.override_output if data.override_output is not None else data.edited_output
        if isinstance(edited, dict):
            response_text = str(edited.get("text") or "").strip() or str(edited).strip()
        elif edited is not None:
            response_text = str(edited).strip()
        elif answer_blocks:
            response_text = "\n\n".join(answer_blocks)
        elif data.next_branch:
            response_text = f"Continue on branch: {data.next_branch}"
        else:
            response_text = "Accepted output. Continue."
    elif normalized_resolution == "abort_run":
        response_text = "Abort this run."

    if response_text:
        run_channel = await get_or_create_run_channel(
            db,
            workspace_id=workspace_id,
            run_id=esc.run_id,  # type: ignore[attr-defined]
            graph_id=None,
        )
        await create_message(
            db,
            workspace_id=workspace_id,
            channel_id=run_channel.id,
            data=ChannelMessageCreate(
                role="assistant" if actor_type == "agent" else "user",
                author_type=actor_type,
                author_name=data.actor_name or "You",
                content=response_text,
                run_id=esc.run_id,  # type: ignore[attr-defined]
                node_id=str((esc.context or {}).get("node_id") or ""),
                metadata={"kind": "escalation_resolution", "resolution": normalized_resolution},
            ),
        )

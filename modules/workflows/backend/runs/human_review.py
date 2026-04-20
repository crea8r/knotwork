from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import channels as core_channels
from core.api import runs as core_runs
from libs.auth.backend.models import User
from libs.participants import member_participant_id
from modules.communication.backend import channels_service
from modules.communication.backend.channels_models import ChannelMessage
from modules.communication.backend.channels_schemas import (
    ChannelMessageCreate,
    ChannelMessageRespondRequest,
    DecisionEventCreate,
)
from . import escalations_service
from .escalations_models import Escalation
from .escalations_schemas import EscalationResolve


logger = logging.getLogger(__name__)


def normalize_resolution(value: str) -> str:
    mapping = {
        "approved": "accept_output",
        "guided": "request_revision",
        "edited": "override_output",
        "aborted": "abort_run",
        "accept_output": "accept_output",
        "request_revision": "request_revision",
        "override_output": "override_output",
        "abort_run": "abort_run",
    }
    return mapping.get(value, value)


async def create_run_escalation(
    db: AsyncSession,
    *,
    run_id: str,
    run_node_state_id: UUID,
    workspace_id: UUID,
    type: str,
    context: dict,
    assigned_to: list[str] | None = None,
    timeout_hours: int = 24,
    publish_event: bool = True,
) -> Escalation:
    return await escalations_service.create_escalation(
        db,
        run_id=run_id,
        run_node_state_id=run_node_state_id,
        workspace_id=workspace_id,
        type=type,
        context=context,
        assigned_to=assigned_to,
        timeout_hours=timeout_hours,
        publish_event=publish_event,
    )


def build_resolution_payload(
    *,
    current_user: User,
    member,
    resolution: str,
    guidance: str | None = None,
    override_output: dict | None = None,
    next_branch: str | None = None,
    answers: list[str] | None = None,
    channel_id: UUID | None = None,
    actor_name: str | None = None,
    actor_type: str | None = None,
) -> EscalationResolve:
    normalized_resolution = normalize_resolution(resolution)
    canonical_output = override_output
    return EscalationResolve.model_validate(
        {
            "resolution": normalized_resolution,
            "guidance": guidance,
            "override_output": canonical_output,
            "edited_output": canonical_output,
            "answers": answers,
            "next_branch": next_branch,
            "channel_id": channel_id,
            "actor_name": actor_name or current_user.name,
            "actor_type": actor_type or str(getattr(member, "kind", "") or "human"),
            "actor_participant_id": member_participant_id(member, current_user.id),
        }
    )


def _update_request_message_status(
    message: ChannelMessage,
    *,
    status: str,
    resolution: str,
    resolved_at: datetime | None = None,
    note: str | None = None,
) -> bool:
    metadata = dict(message.metadata_ or {})
    request_meta = metadata.get("request")
    if str(metadata.get("kind") or "") != "request" or not isinstance(request_meta, dict):
        return False

    updated_request = dict(request_meta)
    updated_request["status"] = status
    updated_request["resolved_at"] = (resolved_at or datetime.now(timezone.utc)).isoformat()
    updated_request["resolution"] = resolution
    if note:
        updated_request["note"] = note
    metadata["request"] = updated_request
    message.metadata_ = metadata
    return True


async def respond_to_run_message(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    channel_ref: UUID | str,
    message_id: UUID,
    current_user: User,
    member,
    data: ChannelMessageRespondRequest,
) -> ChannelMessage:
    channel = await core_channels.get_channel(db, workspace_id, channel_ref)
    if channel is None:
        raise ValueError("Channel not found")

    request_message = await db.get(ChannelMessage, message_id)
    if request_message is None or request_message.workspace_id != workspace_id or request_message.channel_id != channel.id:
        raise ValueError("Message not found")

    metadata = dict(request_message.metadata_ or {})
    request_meta = metadata.get("request") if isinstance(metadata.get("request"), dict) else {}
    escalation_id = str(request_meta.get("escalation_id") or metadata.get("escalation_id") or "").strip()
    if not escalation_id:
        raise ValueError("Message is not a structured request")

    payload = build_resolution_payload(
        current_user=current_user,
        member=member,
        resolution=data.resolution,
        guidance=data.guidance,
        override_output=data.override_output if data.override_output is not None else data.edited_output,
        next_branch=data.next_branch,
        answers=data.answers,
        channel_id=channel.id,
        actor_name=data.actor_name,
        actor_type=data.actor_type,
    )
    resolved = await resolve_run_escalation(
        db,
        workspace_id=workspace_id,
        escalation_id=UUID(escalation_id),
        payload=payload,
        update_request_message=request_message,
    )

    result = await channels_service.list_messages(db, workspace_id, channel.id)
    return result[-1] if result else request_message


async def resolve_run_escalation(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    escalation_id: UUID,
    payload: EscalationResolve,
    update_request_message: ChannelMessage | None = None,
) -> Escalation:
    escalation = await escalations_service.get_escalation(db, escalation_id)
    if escalation is None or escalation.workspace_id != workspace_id:
        raise ValueError("Escalation not found")
    if escalation.status != "open":
        raise ValueError("Escalation is not open")

    normalized_resolution = normalize_resolution(payload.resolution)
    normalized_payload = payload.model_copy(
        update={
            "resolution": normalized_resolution,
            "override_output": payload.override_output if payload.override_output is not None else payload.edited_output,
            "edited_output": payload.override_output if payload.override_output is not None else payload.edited_output,
        }
    )

    resolved = await escalations_service.resolve_escalation(db, escalation_id, normalized_payload)
    await _record_decision_event(
        db,
        workspace_id=workspace_id,
        escalation=resolved,
        payload=normalized_payload,
        normalized_resolution=normalized_resolution,
        actor_participant_id=normalized_payload.actor_participant_id,
    )

    await core_runs.publish_event(
        str(resolved.run_id),
        {
            "type": "escalation_resolved",
            "escalation_id": str(resolved.id),
            "resolution": normalized_resolution,
        },
    )

    if normalized_resolution != "abort_run":
        await enqueue_run_resume(str(resolved.run_id), normalized_payload)
    else:
        await abort_run_from_escalation(db, resolved.run_id)

    if update_request_message is not None:
        _update_request_message_status(
            update_request_message,
            status="answered",
            resolution=normalized_resolution,
        )
        await db.commit()
        await db.refresh(update_request_message)

    return resolved


async def enqueue_run_resume(run_id: str, payload: EscalationResolve) -> None:
    import asyncio

    enqueued = False
    try:
        from arq import create_pool
        from arq.connections import RedisSettings

        from libs.config import settings

        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        try:
            await redis.enqueue_job("resume_run", run_id=run_id, resolution=payload.model_dump())
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
        asyncio.create_task(core_runs.resume_run(run_id, payload.model_dump()))
        return

    asyncio.create_task(_resume_if_still_paused(run_id, payload.model_dump(), delay_seconds=3.0))


async def abort_run_from_escalation(db: AsyncSession, run_id: str) -> None:
    await core_runs.stop_run(db, run_id, notify_public=True)


async def _resume_if_still_paused(run_id: str, resolution: dict, delay_seconds: float = 3.0) -> None:
    import asyncio

    from libs.database import AsyncSessionLocal

    await asyncio.sleep(delay_seconds)

    async with AsyncSessionLocal() as db:
        run = await core_runs.get_run(db, run_id)
        if not run or run.status != "paused":
            return
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
    await core_runs.resume_run(run_id, resolution)


async def _record_decision_event(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    escalation: Escalation,
    payload: EscalationResolve,
    normalized_resolution: str,
    actor_participant_id: str | None = None,
) -> None:
    actor_type = payload.actor_type or "human"
    channel_id = payload.channel_id
    if channel_id is None:
        channel_id = await core_channels.find_workflow_channel_for_run(db, escalation.run_id)  # type: ignore[attr-defined]

    decision_payload = {
        "guidance": payload.guidance,
        "override_output": payload.override_output if payload.override_output is not None else payload.edited_output,
        "answers": payload.answers,
        "next_branch": payload.next_branch,
    }
    await core_channels.create_decision(
        db,
        workspace_id=workspace_id,
        channel_id=channel_id,
        data=DecisionEventCreate(
            decision_type=normalized_resolution,
            actor_type=actor_type,
            actor_name=payload.actor_name,
            run_id=escalation.run_id,
            escalation_id=escalation.id,
            payload=decision_payload,
        ),
    )

    questions = [str(question) for question in ((escalation.context or {}).get("questions") or []) if str(question).strip()]
    answers = [str(answer).strip() for answer in (payload.answers or []) if str(answer).strip()]
    answer_blocks = [f"Q: {question}\nA: {answer}" for question, answer in zip(questions, answers) if answer]

    response_text = ""
    if normalized_resolution == "request_revision":
        if answer_blocks:
            response_text = "\n\n".join(answer_blocks)
            if payload.guidance:
                response_text = f"{response_text}\n\nAdditional context:\n{payload.guidance}"
        elif payload.guidance:
            response_text = str(payload.guidance)
    elif normalized_resolution == "override_output":
        edited = payload.override_output if payload.override_output is not None else payload.edited_output
        if isinstance(edited, dict):
            response_text = str(edited.get("text") or "").strip() or str(edited).strip()
        else:
            response_text = str(edited or "")
    elif normalized_resolution == "accept_output":
        edited = payload.override_output if payload.override_output is not None else payload.edited_output
        if isinstance(edited, dict):
            response_text = str(edited.get("text") or "").strip() or str(edited).strip()
        elif edited is not None:
            response_text = str(edited).strip()
        elif answer_blocks:
            response_text = "\n\n".join(answer_blocks)
        elif payload.next_branch:
            response_text = f"Continue on branch: {payload.next_branch}"
        else:
            response_text = "Accepted output. Continue."
    elif normalized_resolution == "abort_run":
        response_text = "Abort this run."

    if not response_text:
        return

    from_role = "operator_or_supervisor"
    operator_id = str((escalation.context or {}).get("operator_id") or "").strip()
    supervisor_id = str((escalation.context or {}).get("supervisor_id") or "").strip()
    actor_pid = str(actor_participant_id or "").strip()
    if actor_pid and actor_pid == operator_id:
        from_role = "operator"
    elif actor_pid and actor_pid == supervisor_id:
        from_role = "supervisor"
    elif actor_type == "system":
        from_role = "orchestrator"

    target_participant_ids: list[str] = []
    if from_role == "operator" and supervisor_id:
        target_participant_ids = [supervisor_id]
    elif from_role == "supervisor" and operator_id:
        target_participant_ids = [operator_id]
    elif supervisor_id:
        target_participant_ids = [supervisor_id]
    elif operator_id:
        target_participant_ids = [operator_id]
    elif actor_pid:
        target_participant_ids = [actor_pid]

    to_role = "participant"
    if target_participant_ids and target_participant_ids[0] == supervisor_id:
        to_role = "supervisor"
    elif target_participant_ids and target_participant_ids[0] == operator_id:
        to_role = "operator"

    run_channel = await core_channels.get_or_create_run_channel(
        db,
        workspace_id=workspace_id,
        run_id=escalation.run_id,
        graph_id=None,
        participant_ids=None,
    )
    await core_channels.create_message(
        db,
        workspace_id=workspace_id,
        channel_id=run_channel.id,
        data=ChannelMessageCreate(
            role="assistant" if actor_type == "agent" else "user",
            author_type=actor_type,
            author_name=payload.actor_name or "You",
            content=response_text,
            run_id=escalation.run_id,
            node_id=str((escalation.context or {}).get("node_id") or ""),
            metadata={
                "kind": "escalation_resolution",
                "resolution": normalized_resolution,
                "escalation_id": str(escalation.id),
                "author_participant_id": actor_participant_id,
                "assigned_to": target_participant_ids,
                "flow": {
                    "protocol": "knotwork.orchestrated_message/v1",
                    "from_role": from_role,
                    "from_kind": "human_or_agent_participant" if actor_type in {"human", "agent"} else "langgraph_machine",
                    "to_role": to_role,
                    "to_participant_ids": target_participant_ids,
                    "about": "request_response",
                    "run_id": str(escalation.run_id),
                    "node_id": str((escalation.context or {}).get("node_id") or ""),
                    "escalation_id": str(escalation.id),
                },
            },
        ),
    )


async def supersede_open_node_escalations(
    db: AsyncSession,
    *,
    run_id: str,
    node_id: str,
) -> None:
    open_escalations = (
        await db.execute(
            select(Escalation).where(
                Escalation.run_id == run_id,
                Escalation.status == "open",
            )
        )
    ).scalars().all()
    if not open_escalations:
        return

    resolved_at = datetime.now(timezone.utc)
    superseded_ids = {str(escalation.id) for escalation in open_escalations}
    for escalation in open_escalations:
        escalation.status = "timed_out"
        escalation.resolution = None
        escalation.resolution_data = {
            "note": "superseded_by_new_escalation",
            "node_id": node_id,
        }
        escalation.resolved_at = resolved_at

    request_messages = (
        await db.execute(
            select(ChannelMessage).where(
                ChannelMessage.run_id == run_id,
                ChannelMessage.node_id == node_id,
            )
        )
    ).scalars().all()
    for message in request_messages:
        metadata = dict(message.metadata_ or {})
        request_meta = metadata.get("request") if isinstance(metadata.get("request"), dict) else None
        if not isinstance(request_meta, dict):
            continue
        escalation_id = str(request_meta.get("escalation_id") or "").strip()
        if escalation_id not in superseded_ids or str(request_meta.get("status") or "open") != "open":
            continue
        _update_request_message_status(
            message,
            status="superseded",
            resolution="superseded_by_new_escalation",
            resolved_at=resolved_at,
            note="superseded_by_new_escalation",
        )

    await db.commit()

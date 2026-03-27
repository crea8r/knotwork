"""OpenClaw main chat session management and message dispatch."""
from __future__ import annotations

import asyncio
from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels import service as channels_service
from knotwork.channels.schemas import ChannelMessageCreate
from knotwork.openclaw_integrations.models import OpenClawExecutionEvent, OpenClawExecutionTask
from knotwork.registered_agents.schemas import (
    AgentMainChatAskRequest,
    AgentMainChatAskResponse,
    AgentMainChatEnsureResponse,
)
from knotwork.registered_agents.service_utils import _get_agent_row, _now


# ── Prompt builders ────────────────────────────────────────────────────────────

def _main_chat_system_prompt(display_name: str) -> str:
    return (
        f"You are {display_name}, connected to Knotwork main session chat.\n"
        "This is not a workflow run. Respond conversationally and concretely.\n"
        "Use available skills/tools as needed. If uncertain, state unknowns explicitly.\n"
    )


def _main_session_name(workspace_id: UUID, agent_id: UUID) -> str:
    return f"knotwork:{agent_id}:{workspace_id}:main"


def _main_chat_init_prompt(display_name: str, session_name: str) -> str:
    return (
        f"Initialize and continue using this OpenClaw session key: {session_name}\n"
        f"Agent display name: {display_name}\n"
        "Confirm readiness with a short acknowledgement."
    )


# ── Task polling ───────────────────────────────────────────────────────────────

async def _wait_openclaw_task(
    db: AsyncSession, task_id: UUID, timeout_seconds: int = 300
) -> tuple[str, str | None, str | None]:
    """Poll for task completion, starting a fresh DB snapshot on each iteration.

    Uses db.rollback() before each SELECT so the session begins a new transaction
    and sees all committed data (avoids stale reads under REPEATABLE READ isolation).
    """
    deadline = asyncio.get_event_loop().time() + timeout_seconds
    while asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(1)
        await db.rollback()
        result = await db.execute(
            select(OpenClawExecutionTask).where(OpenClawExecutionTask.id == task_id)
        )
        current = result.scalar_one_or_none()
        if current is None:
            raise HTTPException(status_code=500, detail="OpenClaw task disappeared")
        if current.status == "completed":
            return ("completed", current.output_text or "", None)
        if current.status == "escalated":
            return ("escalated", None, current.escalation_question or "Need human input")
        if current.status == "failed":
            return ("failed", current.error_message or "OpenClaw execution failed", None)
    return ("timeout", "OpenClaw task timed out", None)


async def _append_openclaw_task_logs_to_main_channel(
    db: AsyncSession, workspace_id: UUID, channel_id: UUID, task_id: UUID
) -> None:
    events_q = await db.execute(
        select(OpenClawExecutionEvent)
        .where(OpenClawExecutionEvent.task_id == task_id)
        .order_by(OpenClawExecutionEvent.created_at.asc())
    )
    for ev in events_q.scalars():
        if ev.event_type not in ("log", "log_entry", "tool_call"):
            continue
        payload = ev.payload_json or {}
        text = str(payload.get("content") or ev.event_type)
        await channels_service.create_message(
            db, workspace_id=workspace_id, channel_id=channel_id,
            data=ChannelMessageCreate(
                role="system", author_type="system", author_name="OpenClaw", content=text,
                metadata={"kind": "main_chat_plugin_log", "task_id": str(task_id),
                          "event_type": ev.event_type, "payload": payload},
            ),
        )


# ── Session init (ensure-ready) ────────────────────────────────────────────────

async def ensure_main_chat_ready(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID
) -> AgentMainChatEnsureResponse:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    if ra.provider != "openclaw":
        raise HTTPException(status_code=400, detail="Main chat initialization is available for OpenClaw agents only")
    if not ra.openclaw_integration_id or not ra.openclaw_remote_agent_id:
        raise HTTPException(status_code=400, detail="OpenClaw integration binding is missing")

    main_channel = await channels_service.get_or_create_agent_main_channel(
        db, workspace_id=workspace_id, agent_id=agent_id, display_name=ra.display_name,
    )
    session_name = _main_session_name(workspace_id, ra.id)
    main_channel_id = main_channel.id  # capture before any commit

    msgs = await channels_service.list_messages(db, workspace_id, main_channel_id)
    for m in reversed(msgs[-200:]):
        if str((m.metadata_ or {}).get("kind") or "") == "main_session_ready":
            return AgentMainChatEnsureResponse(
                ready=True, status="already_ready", task_id=None, session_name=session_name,
            )

    task_q = await db.execute(
        select(OpenClawExecutionTask)
        .where(OpenClawExecutionTask.workspace_id == workspace_id)
        .where(OpenClawExecutionTask.integration_id == ra.openclaw_integration_id)
        .where(OpenClawExecutionTask.node_id == "agent_main_init")
        .where(OpenClawExecutionTask.session_token == f"agent-main-init:{agent_id}")
        .order_by(OpenClawExecutionTask.created_at.desc())
        .limit(1)
    )
    latest_init = task_q.scalar_one_or_none()

    if latest_init is not None:
        await db.refresh(latest_init)
        if latest_init.status == "completed":
            init_id = latest_init.id
            init_output = latest_init.output_text or ""
            await _append_openclaw_task_logs_to_main_channel(
                db, workspace_id=workspace_id, channel_id=main_channel_id, task_id=init_id,
            )
            await channels_service.create_message(
                db, workspace_id=workspace_id, channel_id=main_channel_id,
                data=ChannelMessageCreate(
                    role="system", author_type="system", author_name="Knotwork",
                    content="Main chat session initialized.",
                    metadata={"kind": "main_session_ready", "agent_id": str(agent_id),
                              "task_id": str(init_id), "session_name": session_name,
                              "init_reply": init_output},
                ),
            )
            return AgentMainChatEnsureResponse(
                ready=True, status="initialized", task_id=init_id, session_name=session_name,
            )

        if latest_init.status in ("pending", "claimed"):
            hard_deadline = latest_init.created_at + timedelta(seconds=600)
            if _now() < hard_deadline:
                return AgentMainChatEnsureResponse(
                    ready=False, status="initializing", task_id=latest_init.id,
                    session_name=session_name, message="Main chat is being initialized.",
                )
            # Hard timeout — mark failed before committing
            _li_id = latest_init.id
            latest_init.status = "failed"
            latest_init.error_message = "Main chat initialization hard timeout (600s)"
            latest_init.completed_at = _now()
            latest_init.updated_at = _now()
            await db.commit()
            await _append_openclaw_task_logs_to_main_channel(
                db, workspace_id=workspace_id, channel_id=main_channel_id, task_id=_li_id,
            )
            return AgentMainChatEnsureResponse(
                ready=False, status="timeout", task_id=_li_id, session_name=session_name,
                message="Main chat initialization timed out. Retry to start a new init task.",
            )

    # No existing init task — create one
    ra_integration_id = ra.openclaw_integration_id
    ra_remote_agent_id = ra.openclaw_remote_agent_id
    ra_agent_ref = ra.agent_ref
    ra_display_name = ra.display_name
    init_task = OpenClawExecutionTask(
        id=uuid4(), workspace_id=workspace_id, integration_id=ra_integration_id,
        run_id=None, node_id="agent_main_init", agent_ref=ra_agent_ref,
        remote_agent_id=ra_remote_agent_id,
        system_prompt=_main_chat_system_prompt(ra_display_name),
        user_prompt=_main_chat_init_prompt(ra_display_name, session_name),
        session_token=f"agent-main-init:{agent_id}",
        status="pending", created_at=_now(), updated_at=_now(),
    )
    init_task_id = init_task.id  # capture before commit
    db.add(init_task)
    await db.commit()
    return AgentMainChatEnsureResponse(
        ready=False, status="initializing", task_id=init_task_id,
        session_name=session_name, message="Main chat initialization started.",
    )


# ── Chat message listing and sending ───────────────────────────────────────────

async def list_main_chat_messages(db: AsyncSession, workspace_id: UUID, agent_id: UUID):
    ra = await _get_agent_row(db, workspace_id, agent_id)
    main_channel = await channels_service.get_or_create_agent_main_channel(
        db, workspace_id=workspace_id, agent_id=agent_id, display_name=ra.display_name,
    )
    return await channels_service.list_messages(db, workspace_id, main_channel.id)


async def ask_main_chat(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, data: AgentMainChatAskRequest
) -> AgentMainChatAskResponse:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    if ra.provider != "openclaw":
        raise HTTPException(status_code=400, detail="Main chat execution is available for OpenClaw agents only")
    if not ra.openclaw_integration_id or not ra.openclaw_remote_agent_id:
        raise HTTPException(status_code=400, detail="OpenClaw integration binding is missing")

    ensured = await ensure_main_chat_ready(db, workspace_id, agent_id)
    if not ensured.ready:
        raise HTTPException(status_code=409, detail=ensured.message or "Main chat is still initializing")

    main_channel = await channels_service.get_or_create_agent_main_channel(
        db, workspace_id=workspace_id, agent_id=agent_id, display_name=ra.display_name,
    )
    user_text = data.message.strip()
    if not user_text and not data.attachments:
        raise HTTPException(status_code=400, detail="Message or attachment required")

    # Capture scalars before commit — ORM objects expire after await db.commit(),
    # and attribute access in an async session triggers MissingGreenlet.
    main_channel_id = main_channel.id
    ra_id = ra.id
    ra_display_name = ra.display_name
    ra_integration_id = ra.openclaw_integration_id
    ra_remote_agent_id = ra.openclaw_remote_agent_id
    ra_agent_ref = ra.agent_ref

    # Build channel display text (what the operator sees in the chat history)
    channel_display = user_text or "📎 [File attached]"
    if data.attachments:
        names = ", ".join(a.filename for a in data.attachments)
        channel_display = f"{user_text}\n📎 {names}".strip() if user_text else f"📎 {names}"

    await channels_service.create_message(
        db, workspace_id=workspace_id, channel_id=main_channel_id,
        data=ChannelMessageCreate(
            role="user", author_type="human", author_name="Operator", content=channel_display,
            metadata={"kind": "main_chat_user", "agent_id": str(agent_id),
                      "session_name": _main_session_name(workspace_id, ra_id)},
        ),
    )

    # Build the user_prompt for OpenClaw — include attachment URLs so the LLM
    # can reference the files even if the OpenClaw plugin doesn't check task.attachments.
    attachments_json = [a.model_dump() for a in data.attachments]
    if attachments_json:
        attach_lines = "\n".join(
            f"- {a['filename']} ({a['mime_type']}, {a['size'] // 1024} KB)\n  URL: {a['url']}"
            for a in attachments_json
        )
        attachment_block = f"\n\n[Attached files]\n{attach_lines}"
    else:
        attachment_block = ""
    user_prompt = f"{user_text}{attachment_block}".strip()

    task = OpenClawExecutionTask(
        id=uuid4(), workspace_id=workspace_id, integration_id=ra_integration_id,
        run_id=None, node_id="agent_main", agent_ref=ra_agent_ref,
        remote_agent_id=ra_remote_agent_id,
        system_prompt=_main_chat_system_prompt(ra_display_name),
        user_prompt=user_prompt, session_token=f"agent-main:{agent_id}",
        attachments_json=attachments_json,
        status="pending", created_at=_now(), updated_at=_now(),
    )
    task_id = task.id  # capture before commit
    db.add(task)
    await db.commit()
    await channels_service.emit_task_assigned_event(
        db,
        workspace_id=workspace_id,
        agent_id=agent_id,
        channel_id=main_channel_id,
        title=f"Main chat task assigned to {ra_display_name}",
        subtitle=(user_text or "New main chat request")[:160],
        source_id=str(task_id),
    )

    task_status, reply, question = await _wait_openclaw_task(db, task_id, timeout_seconds=300)
    await _append_openclaw_task_logs_to_main_channel(
        db, workspace_id=workspace_id, channel_id=main_channel_id, task_id=task_id,
    )

    if task_status == "completed":
        text = reply or ""
        await channels_service.create_message(
            db, workspace_id=workspace_id, channel_id=main_channel_id,
            data=ChannelMessageCreate(
                role="assistant", author_type="agent", author_name=ra_display_name, content=text,
                metadata={"kind": "main_chat_reply", "task_id": str(task_id),
                          "session_name": _main_session_name(workspace_id, ra_id)},
            ),
        )
        return AgentMainChatAskResponse(task_id=task_id, status="completed", reply=text)

    if task_status == "escalated":
        q = question or "Need human input"
        await channels_service.create_message(
            db, workspace_id=workspace_id, channel_id=main_channel_id,
            data=ChannelMessageCreate(
                role="assistant", author_type="agent", author_name=ra_display_name, content=q,
                metadata={"kind": "main_chat_escalation", "task_id": str(task_id)},
            ),
        )
        return AgentMainChatAskResponse(task_id=task_id, status="escalated", question=q)

    text = reply or "Main chat request timed out."
    kind = "main_chat_timeout" if task_status == "timeout" else "main_chat_error"
    await channels_service.create_message(
        db, workspace_id=workspace_id, channel_id=main_channel_id,
        data=ChannelMessageCreate(
            role="system", author_type="system", author_name="OpenClaw", content=text,
            metadata={"kind": kind, "task_id": str(task_id)},
        ),
    )
    return AgentMainChatAskResponse(task_id=task_id, status=task_status, reply=text)

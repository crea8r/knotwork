"""OpenClaw adapter — plugin-first execution bridge.

Flow:
1. Runtime creates execution task row for plugin integration.
2. OpenClaw plugin pulls pending tasks and executes in OpenClaw runtime.
3. Plugin posts task events back to Knotwork.
4. Adapter polls task/events and yields NodeEvents.

agent_ref must be "openclaw". The specific integration + remote agent
are resolved via registered_agent_id on the node def.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import TYPE_CHECKING, AsyncGenerator
from uuid import UUID, uuid4  # UUID still used for workspace_id/integration_id

from sqlalchemy import select

from knotwork.database import AsyncSessionLocal
from knotwork.openclaw_integrations.models import (
    OpenClawExecutionEvent,
    OpenClawExecutionTask,
    OpenClawRemoteAgent,
)
from knotwork.registered_agents.models import RegisteredAgent
from knotwork.runtime.adapters.base import AgentAdapter, NodeEvent
from knotwork.projects.service import render_project_context

if TYPE_CHECKING:
    from knotwork.runtime.knowledge_loader import KnowledgeTree

_POLL_INTERVAL_SECONDS = 2
_HEARTBEAT_SECONDS = 300  # log a progress entry every 5 minutes


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _extract_run_attachments(context_files: list[dict]) -> list[dict]:
    out: list[dict] = []
    for item in context_files or []:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        url = str(item.get("url") or "").strip()
        filename = str(item.get("filename") or item.get("name") or "").strip()
        attachment_id = str(item.get("attachment_id") or "").strip()
        if not key or not url or not filename or not attachment_id:
            continue
        try:
            size = int(item.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        out.append({
            "key": key, "url": url, "filename": filename,
            "mime_type": str(item.get("mime_type") or "application/octet-stream"),
            "size": size, "attachment_id": attachment_id,
        })
    return out


class OpenClawAdapter(AgentAdapter):
    async def run_node(
        self,
        node_def: dict,
        run_state: dict,
        knowledge_tree: "KnowledgeTree",
        session_token: str,
        outgoing_edges: list[dict] | None = None,
        targets: list[str] | None = None,
        trust: float = 0.5,
        retry_guidance: str | None = None,
    ) -> AsyncGenerator[NodeEvent, None]:
        config = node_def.get("config", {})
        node_id: str = node_def.get("id")
        run_id = str(run_state["run_id"])
        _edges = outgoing_edges or []
        _targets = targets or []

        # ── Resolve integration + remote agent via registered_agent_id ──────
        integration_id: UUID | None = None
        remote_agent_id: str | None = None
        registered_agent_id = node_def.get("registered_agent_id")

        async with AsyncSessionLocal() as db:
            if registered_agent_id:
                ra = await db.get(RegisteredAgent, UUID(str(registered_agent_id)))
                if ra and ra.openclaw_integration_id and ra.openclaw_remote_agent_id:
                    integration_id = ra.openclaw_integration_id
                    remote_agent_id = ra.openclaw_remote_agent_id

            if integration_id is None or remote_agent_id is None:
                yield NodeEvent("failed", {
                    "error": (
                        f"Node '{node_id}' has no OpenClaw binding. "
                        "Assign a registered OpenClaw agent in the node config."
                    )
                })
                return

            attachments_json = _extract_run_attachments(run_state.get("context_files", []))

            # ── Reuse or create execution task ───────────────────────────────
            # Build prompts first (needed for task creation)
            from knotwork.runtime.nodes.agent import _build_routing_block, _build_completion_protocol
            from knotwork.runtime.prompt_builder import build_agent_prompt

            # OpenClaw subagent is killed after every task — no in-memory context survives.
            # Always build the full prompt so GUIDELINES + COMPLETION PROTOCOL are present.
            # On retry: append HUMAN INTERVENTION at the end (don't strip the base prompt).
            all_outputs: dict = run_state.get("node_outputs") or {}
            is_first_node = not all_outputs
            run_fields = run_state.get("input", {}) if is_first_node else {}
            context_files_for_prompt = run_state.get("context_files", []) if is_first_node else []

            project_id = run_state.get("project_id")
            project_context = await render_project_context(
                db,
                UUID(str(run_state["workspace_id"])),
                UUID(str(project_id)) if project_id else None,
            )
            system_prompt, user_prompt = build_agent_prompt(
                tree=knowledge_tree,
                state_fields=run_fields,
                context_files=context_files_for_prompt,
                project_context=project_context,
                prior_outputs=None,
            )
            if is_first_node:
                attachments_for_prompt = _extract_run_attachments(run_state.get("context_files", []))
                if attachments_for_prompt:
                    attach_lines = "\n".join(
                        f"- {a['filename']} ({a['mime_type']}, {a['size']} bytes)\n  URL: {a['url']}"
                        for a in attachments_for_prompt
                    )
                    user_prompt = f"{user_prompt}\n\n[Attached files]\n{attach_lines}"

            _node_prompts = (run_state.get("input") or {}).get("_node_system_prompts") or {}
            extra = str(_node_prompts[node_id]) if node_id in _node_prompts else (
                config.get("system_prompt") or config.get("instructions", "")
            )
            if extra:
                system_prompt = f"{system_prompt}\n\n{extra}"
                user_prompt = f"=== TASK INSTRUCTIONS ===\n{extra}\n\n---\n\n{user_prompt}"

            system_prompt += (
                f"\n\n=== AUTONOMY LEVEL ===\n"
                f"Trust: {trust:.1f} — "
                f"0.0 means always ask the human before deciding; "
                f"1.0 means act fully autonomously."
            )
            # ROUTING (if multi-branch) immediately before COMPLETION PROTOCOL in user_prompt.
            routing_block = (
                f"\n\n{_build_routing_block(_edges, _targets)}" if len(_targets) > 1 else ""
            )
            user_prompt = f"{user_prompt}{routing_block}\n\n{_build_completion_protocol(_targets)}"

            if retry_guidance:
                user_prompt = f"{user_prompt}\n\n=== HUMAN INTERVENTION ===\n{retry_guidance}"

            existing_q = await db.execute(
                select(OpenClawExecutionTask)
                .where(OpenClawExecutionTask.workspace_id == UUID(str(run_state["workspace_id"])))
                .where(OpenClawExecutionTask.integration_id == integration_id)
                .where(OpenClawExecutionTask.run_id == run_id)
                .where(OpenClawExecutionTask.node_id == node_id)
                .where(OpenClawExecutionTask.session_token == session_token)
                .where(OpenClawExecutionTask.status.in_(("pending", "claimed")))
                .order_by(OpenClawExecutionTask.created_at.desc())
                .limit(1)
            )
            existing = existing_q.scalar_one_or_none()
            if existing is not None:
                task_id = existing.id
                resumed_existing_task = True
            else:
                task = OpenClawExecutionTask(
                    id=uuid4(),
                    workspace_id=UUID(str(run_state["workspace_id"])),
                    integration_id=integration_id,
                    run_id=run_id,
                    node_id=node_id,
                    agent_ref="openclaw",
                    remote_agent_id=remote_agent_id,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    session_token=session_token,
                    attachments_json=attachments_json,
                    status="pending",
                    created_at=_now(),
                    updated_at=_now(),
                )
                db.add(task)
                await db.commit()
                from knotwork.channels import service as channel_service

                registered_agent = (
                    await db.execute(
                        select(RegisteredAgent).where(
                            RegisteredAgent.workspace_id == UUID(str(run_state["workspace_id"])),
                            RegisteredAgent.openclaw_integration_id == integration_id,
                            RegisteredAgent.openclaw_remote_agent_id == remote_agent_id,
                        ).limit(1)
                    )
                ).scalar_one_or_none()
                if registered_agent is not None:
                    agent_channel = await channel_service.get_or_create_agent_main_channel(
                        db,
                        workspace_id=registered_agent.workspace_id,
                        agent_id=registered_agent.id,
                        display_name=registered_agent.display_name,
                    )
                    await channel_service.emit_task_assigned_event(
                        db,
                        workspace_id=registered_agent.workspace_id,
                        agent_id=registered_agent.id,
                        channel_id=agent_channel.id,
                        title=f"Task assigned for run {run_id}",
                        subtitle=f"Node {node_id} needs agent work",
                        source_id=str(task.id),
                    )
                task_id = task.id
                resumed_existing_task = False

        yield NodeEvent("started", {
            "model": "openclaw",
            "bridge": "openclaw_plugin",
            "task_id": str(task_id),
            "resumed_existing_task": resumed_existing_task,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
        })

        seen_event_ids: set[str] = set()
        last_heartbeat = asyncio.get_event_loop().time()

        while True:
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)

            async with AsyncSessionLocal() as db:
                task = await db.get(OpenClawExecutionTask, task_id)
                if task is None:
                    yield NodeEvent("failed", {"error": "OpenClaw task disappeared"})
                    return

                from knotwork.runs.models import Run
                run_row = await db.get(Run, run_id)
                if run_row and run_row.status == "stopped":
                    yield NodeEvent("failed", {"error": "Run was stopped by operator"})
                    return

                events_q = await db.execute(
                    select(OpenClawExecutionEvent)
                    .where(OpenClawExecutionEvent.task_id == task_id)
                    .order_by(OpenClawExecutionEvent.created_at.asc())
                )
                events = list(events_q.scalars())

            for ev in events:
                ev_id = str(ev.id)
                if ev_id in seen_event_ids:
                    continue
                seen_event_ids.add(ev_id)
                payload = ev.payload_json or {}
                if ev.event_type in ("log", "log_entry", "tool_call"):
                    yield NodeEvent("log_entry", {
                        "entry_type": payload.get("entry_type", "observation"),
                        "content": payload.get("content", ev.event_type),
                        "metadata": payload.get("metadata", payload),
                    })

            if task.status == "completed":
                yield NodeEvent("completed", {
                    "output": task.output_text or "",
                    "next_branch": task.next_branch,
                })
                return

            if task.status == "escalated":
                # Read questions array; fall back to legacy single question
                questions: list[str] = getattr(task, "escalation_questions_json", None) or []
                if not questions and task.escalation_question:
                    questions = [task.escalation_question]
                yield NodeEvent("escalation", {
                    "questions": questions,
                    "output": task.output_text or "",
                })
                return

            if task.status == "failed":
                yield NodeEvent("failed", {"error": task.error_message or "OpenClaw execution failed"})
                return

            now = asyncio.get_event_loop().time()
            if now - last_heartbeat >= _HEARTBEAT_SECONDS:
                last_heartbeat = now
                yield NodeEvent("log_entry", {
                    "entry_type": "progress",
                    "content": f"OpenClaw task still running… (task_id={task_id})",
                    "metadata": {"task_id": str(task_id)},
                })
                async with AsyncSessionLocal() as db:
                    t = await db.get(OpenClawExecutionTask, task_id)
                    if t is not None and t.status == "claimed":
                        t.updated_at = _now()
                        await db.commit()

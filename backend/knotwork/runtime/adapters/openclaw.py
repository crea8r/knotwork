"""OpenClaw adapter — plugin-first execution bridge.

Flow:
1. Runtime creates execution task row for plugin integration.
2. OpenClaw plugin pulls pending tasks and executes in OpenClaw runtime.
3. Plugin posts task events back to Knotwork.
4. Adapter polls task/events and yields NodeEvents.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import TYPE_CHECKING, AsyncGenerator
from uuid import UUID, uuid4

from sqlalchemy import and_, select

from knotwork.database import AsyncSessionLocal
from knotwork.openclaw_integrations.models import (
    OpenClawExecutionEvent,
    OpenClawExecutionTask,
    OpenClawRemoteAgent,
)
from knotwork.registered_agents.models import RegisteredAgent
from knotwork.runtime.adapters.base import AgentAdapter, NodeEvent

if TYPE_CHECKING:
    from knotwork.runtime.knowledge_loader import KnowledgeTree

_MAX_WAIT_SECONDS = 300


def _now() -> datetime:
    return datetime.now(timezone.utc)


class OpenClawAdapter(AgentAdapter):
    async def run_node(
        self,
        node_def: dict,
        run_state: dict,
        knowledge_tree: "KnowledgeTree",
        session_token: str,
    ) -> AsyncGenerator[NodeEvent, None]:
        from knotwork.runtime.prompt_builder import build_agent_prompt

        config = node_def.get("config", {})
        agent_ref: str = node_def.get("agent_ref", "openclaw:main")
        node_id: str = node_def.get("id")
        run_id = UUID(str(run_state["run_id"]))

        all_outputs: dict = run_state.get("node_outputs") or {}
        input_sources: list[str] | None = config.get("input_sources")
        if input_sources is None:
            run_fields = run_state.get("input", {})
            prior_outputs = dict(all_outputs) if all_outputs else None
        else:
            run_fields = run_state.get("input", {}) if "run_input" in input_sources else {}
            selected = {nid: all_outputs[nid] for nid in input_sources if nid in all_outputs}
            prior_outputs = selected if selected else None

        system_prompt, user_prompt = build_agent_prompt(
            tree=knowledge_tree,
            state_fields=run_fields,
            context_files=run_state.get("context_files", []),
            prior_outputs=prior_outputs,
        )
        extra = config.get("system_prompt") or config.get("instructions", "")
        if extra:
            system_prompt = f"{system_prompt}\n\n{extra}"

        system_prompt = (
            f"{system_prompt}\n\n"
            "=== TOOLING POLICY ===\n"
            "- Use available tools before escalating.\n"
            "- If uncertain, provide best-effort output with unknowns clearly marked."
        )

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
                slug = agent_ref.removeprefix("openclaw:")
                r = await db.execute(
                    select(OpenClawRemoteAgent)
                    .where(OpenClawRemoteAgent.slug == slug)
                    .where(OpenClawRemoteAgent.workspace_id == UUID(str(run_state["workspace_id"])))
                    .where(OpenClawRemoteAgent.is_active == True)  # noqa: E712
                    .order_by(OpenClawRemoteAgent.last_synced_at.desc())
                    .limit(1)
                )
                remote = r.scalar_one_or_none()
                if remote is None:
                    yield NodeEvent("failed", {"error": f"No OpenClaw binding found for {agent_ref}"})
                    return
                integration_id = remote.integration_id
                remote_agent_id = remote.remote_agent_id

            task = OpenClawExecutionTask(
                id=uuid4(),
                workspace_id=UUID(str(run_state["workspace_id"])),
                integration_id=integration_id,
                run_id=run_id,
                node_id=node_id,
                agent_ref=agent_ref,
                remote_agent_id=remote_agent_id,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                session_token=session_token,
                status="pending",
                created_at=_now(),
                updated_at=_now(),
            )
            db.add(task)
            await db.commit()
            task_id = task.id

        yield NodeEvent("started", {"model": agent_ref, "bridge": "openclaw_plugin", "task_id": str(task_id)})

        seen_event_ids: set[str] = set()
        deadline = asyncio.get_event_loop().time() + _MAX_WAIT_SECONDS

        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(1)
            async with AsyncSessionLocal() as db:
                task = await db.get(OpenClawExecutionTask, task_id)
                if task is None:
                    yield NodeEvent("failed", {"error": "OpenClaw task disappeared"})
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
                yield NodeEvent("escalation", {
                    "question": task.escalation_question or "Need human input",
                    "options": task.escalation_options_json or [],
                })
                return

            if task.status == "failed":
                yield NodeEvent("failed", {"error": task.error_message or "OpenClaw execution failed"})
                return

        yield NodeEvent("failed", {"error": "OpenClaw plugin execution timeout"})

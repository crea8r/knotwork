"""
Participant-driven agent node execution.

Each agent node creates a task in the run channel for its configured operator,
with the supervisor included for visibility / intervention. The run then pauses
until one of those participants resolves the task through the existing
escalation flow (UI or MCP).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

if TYPE_CHECKING:
    from knotwork.runtime.engine import RunState


MAX_NODE_VISITS_PER_RUN = 5


def _resolve_agent_ref(node_def: dict) -> str:
    ref = str(node_def.get("agent_ref") or "").strip()
    return ref or "human"


def _build_participant_task_prompt(
    *,
    node_name: str,
    config: dict,
    run_input: dict | None,
    current_output: str | None,
    knowledge_files: list[str],
    retry_guidance: str | None = None,
) -> str:
    instruction = str(
        config.get("system_prompt")
        or config.get("question")
        or f"Complete the task for node '{node_name}'."
    ).strip()
    sections = [f"## Task\n{instruction or node_name}"]
    if retry_guidance:
        sections.append(f"## Revision Request\n{retry_guidance}")
    if current_output:
        sections.append(f"## Current Input\n{current_output}")
    elif run_input:
        sections.append(f"## Run Input\n{run_input}")
    if knowledge_files:
        sections.append("## Handbook Context\n" + "\n".join(f"- {path}" for path in knowledge_files))
    return "\n\n".join(section for section in sections if section.strip())


def _resolution_output_text(resolution: dict) -> str | None:
    edited = resolution.get("override_output") or resolution.get("edited_output")
    if isinstance(edited, dict):
        text = str(edited.get("text") or "").strip()
        return text or str(edited).strip() or None
    if edited is not None:
        text = str(edited).strip()
        if text:
            return text

    answers = [str(answer).strip() for answer in (resolution.get("answers") or []) if str(answer).strip()]
    if answers:
        return "\n\n".join(answers)

    guidance = str(resolution.get("guidance") or "").strip()
    return guidance or None


def _normalize_resolution_type(value: str | None) -> str:
    raw = str(value or "request_revision")
    mapping = {
        "approved": "accept_output",
        "edited": "override_output",
        "guided": "request_revision",
        "aborted": "abort_run",
    }
    return mapping.get(raw, raw)


async def _create_participant_escalation(
    *,
    ns_id: UUID,
    run_id: str,
    node_id: str,
    workspace_id: str,
    recipients: list[str],
    context: dict,
) -> UUID:
    from sqlalchemy import update

    from knotwork.database import AsyncSessionLocal
    from knotwork.escalations.models import Escalation
    from knotwork.escalations.service import create_escalation
    from knotwork.runs.models import RunNodeState

    async with AsyncSessionLocal() as db:
        ns = await db.get(RunNodeState, ns_id)
        if ns is not None:
            ns.status = "paused"
            ns.completed_at = datetime.now(timezone.utc)
            await db.commit()

        await db.execute(
            update(Escalation)
            .where(Escalation.run_id == run_id, Escalation.status == "open")
            .values(
                status="timed_out",
                resolution=None,
                resolution_data={"note": "superseded_by_new_escalation", "node_id": node_id},
                resolved_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()

        esc = await create_escalation(
            db,
            run_id=run_id,
            run_node_state_id=ns_id,
            workspace_id=UUID(workspace_id),
            type="agent_question",
            context=context,
            assigned_to=recipients,
        )
        return esc.id


def make_agent_node(node_def: dict, outgoing_edges: list[dict] | None = None):
    node_id: str = node_def["id"]
    node_name: str = node_def.get("name") or node_id
    config: dict = node_def.get("config") or {}
    knowledge_files: list[str] = config.get("knowledge_paths") or config.get("knowledge_files", [])
    operator_id = str(node_def.get("operator_id") or "").strip() or None
    supervisor_id = str(node_def.get("supervisor_id") or "").strip() or None

    _edges: list[dict] = outgoing_edges or []
    _targets: list[str] = [edge["target"] for edge in _edges]

    async def node_fn(state: "RunState") -> dict:
        from langgraph.types import interrupt

        from knotwork.channels import service as channel_service
        from knotwork.channels.schemas import ChannelMessageCreate
        from knotwork.database import AsyncSessionLocal
        from knotwork.participants import resolve_participant_ids
        from knotwork.runtime.events import publish_event
        from knotwork.runtime.knowledge_loader import KnowledgeTree, load_knowledge_tree
        from knotwork.runs.models import RunNodeState, RunWorklogEntry

        run_id = str(state["run_id"])
        workspace_id = state["workspace_id"]
        agent_ref = _resolve_agent_ref(node_def)
        visit_counts = state.get("node_visit_counts") or {}
        current_visit = int(visit_counts.get(node_id) or 0) + 1

        if current_visit > MAX_NODE_VISITS_PER_RUN:
            async with AsyncSessionLocal() as db:
                db.add(RunWorklogEntry(
                    id=uuid4(),
                    run_id=run_id,
                    node_id=node_id,
                    agent_ref=agent_ref,
                    entry_type="action",
                    content=(
                        f"Loop safety limit reached at {node_name}. "
                        f"Visit {current_visit} would exceed the maximum of {MAX_NODE_VISITS_PER_RUN}."
                    ),
                    metadata_={
                        "kind": "loop_limit_reached",
                        "visit_index": current_visit,
                        "max_visits": MAX_NODE_VISITS_PER_RUN,
                        "node_name": node_name,
                    },
                ))
                await db.commit()
            raise RuntimeError(
                f"Loop safety limit reached for node '{node_name}' "
                f"(visit {current_visit} exceeds max {MAX_NODE_VISITS_PER_RUN})"
            )

        tree = await load_knowledge_tree(knowledge_files, workspace_id) if knowledge_files else KnowledgeTree()
        async with AsyncSessionLocal() as db:
            recipients = await resolve_participant_ids(
                db,
                UUID(workspace_id),
                [participant_id for participant_id in [operator_id, supervisor_id] if participant_id],
            )
        if not recipients:
            raise RuntimeError(f"Node '{node_name}' has no operator or supervisor assigned")

        retry_guidance: str | None = None
        output_text = ""
        next_branch_val: str | None = None
        ns_id: UUID | None = None

        async with AsyncSessionLocal() as db:
            from sqlalchemy import select

            existing_state = await db.execute(
                select(RunNodeState)
                .where(
                    RunNodeState.run_id == run_id,
                    RunNodeState.node_id == node_id,
                    RunNodeState.status.in_(("paused", "running")),
                )
                .order_by(RunNodeState.started_at.desc().nullslast(), RunNodeState.id.desc())
                .limit(1)
            )
            existing_ns = existing_state.scalar_one_or_none()
            if existing_ns is not None:
                ns_id = existing_ns.id

        while True:
            prompt = _build_participant_task_prompt(
                node_name=node_name,
                config=config,
                run_input=state.get("input"),
                current_output=str(state.get("current_output") or "").strip() or None,
                knowledge_files=knowledge_files,
                retry_guidance=retry_guidance,
            )

            async with AsyncSessionLocal() as db:
                if ns_id is None:
                    ns = RunNodeState(
                        id=uuid4(),
                        run_id=run_id,
                        node_id=node_id,
                        node_name=node_name,
                        agent_ref=agent_ref,
                        status="running",
                        input={
                            "task_prompt": prompt,
                            "run_input": state.get("input"),
                            "current_input": state.get("current_output"),
                            "operator_id": operator_id,
                            "supervisor_id": supervisor_id,
                            "visit_index": current_visit,
                            "max_visits": MAX_NODE_VISITS_PER_RUN,
                            "is_repeat_visit": current_visit > 1,
                        },
                        knowledge_snapshot=tree.version_snapshot,
                        started_at=datetime.now(timezone.utc),
                    )
                    db.add(ns)
                    await db.commit()
                    ns_id = ns.id
                else:
                    ns = await db.get(RunNodeState, ns_id)
                    if ns is not None:
                        ns.status = "running"
                        ns.completed_at = None
                        merged = dict(ns.input or {})
                        merged.update({
                            "task_prompt": prompt,
                            "current_input": state.get("current_output"),
                            "operator_id": operator_id,
                            "supervisor_id": supervisor_id,
                            "visit_index": current_visit,
                            "max_visits": MAX_NODE_VISITS_PER_RUN,
                            "is_repeat_visit": current_visit > 1,
                        })
                        ns.input = merged
                        await db.commit()

                run_channel = await channel_service.get_or_create_run_channel(
                    db,
                    workspace_id=UUID(workspace_id),
                    run_id=run_id,
                    graph_id=UUID(str(state["graph_id"])) if state.get("graph_id") else None,
                )
                await channel_service.create_message(
                    db,
                    workspace_id=UUID(workspace_id),
                    channel_id=run_channel.id,
                    data=ChannelMessageCreate(
                        role="assistant",
                        author_type="system",
                        author_name=node_name,
                        content=prompt,
                        run_id=run_id,
                        node_id=node_id,
                        metadata={
                            "kind": "node_task",
                            "operator_id": operator_id,
                            "supervisor_id": supervisor_id,
                            "assigned_to": recipients,
                        },
                    ),
                )

            if ns_id is None:
                raise RuntimeError("Node state ID not set")

            escalation_id = await _create_participant_escalation(
                ns_id=ns_id,
                run_id=run_id,
                node_id=node_id,
                workspace_id=workspace_id,
                recipients=recipients,
                context={
                    "questions": [prompt],
                    "prompt": prompt,
                    "node_id": node_id,
                    "operator_id": operator_id,
                    "supervisor_id": supervisor_id,
                    "participant_ids": recipients,
                },
            )

            await publish_event(state["run_id"], {"type": "escalation_created", "node_id": node_id})
            resolution = interrupt({
                "reason": "participant_task",
                "node_id": node_id,
                "escalation_id": str(escalation_id),
            })
            resolution = resolution if isinstance(resolution, dict) else {}
            resolution_type = _normalize_resolution_type(resolution.get("resolution"))

            if resolution_type == "abort_run":
                raise RuntimeError("Run aborted during participant task")

            if resolution_type in {"override_output", "accept_output", "request_revision"}:
                resolved_text = _resolution_output_text(resolution)
                has_explicit_answers = bool(
                    resolution.get("answers")
                    or resolution.get("override_output")
                    or resolution.get("edited_output")
                )
                if resolved_text and (resolution_type != "request_revision" or has_explicit_answers):
                    output_text = resolved_text
                    break

                retry_guidance = resolved_text or "Please provide the task output directly."
                continue

            raise RuntimeError("Run resumed with unsupported participant resolution")

        if len(_targets) > 1 and not next_branch_val and output_text:
            if ns_id is None:
                raise RuntimeError("Node state ID not set")
            routing_prompt = (
                "The task is complete. Choose which branch this run should continue on."
            )
            routing_escalation_id = await _create_participant_escalation(
                ns_id=ns_id,
                run_id=run_id,
                node_id=node_id,
                workspace_id=workspace_id,
                recipients=recipients,
                context={
                    "questions": [],
                    "messages": [routing_prompt],
                    "options": _targets,
                    "node_id": node_id,
                    "operator_id": operator_id,
                    "supervisor_id": supervisor_id,
                    "participant_ids": recipients,
                },
            )
            await publish_event(state["run_id"], {"type": "escalation_created", "node_id": node_id})
            resolution = interrupt({
                "reason": "routing_escalation",
                "node_id": node_id,
                "escalation_id": str(routing_escalation_id),
            })
            resolution = resolution if isinstance(resolution, dict) else {}
            resolution_type = _normalize_resolution_type(resolution.get("resolution"))
            if resolution_type == "abort_run":
                raise RuntimeError("Run aborted during routing escalation")
            if resolution_type == "accept_output":
                chosen = str(resolution.get("next_branch") or "").strip()
                next_branch_val = chosen if chosen in _targets else _targets[0]
            elif resolution_type == "request_revision":
                next_branch_val = _targets[0]
            else:
                next_branch_val = _targets[0]

        if ns_id is None:
            raise RuntimeError("Node state ID not set")

        async with AsyncSessionLocal() as db:
            ns = await db.get(RunNodeState, ns_id)
            if ns is not None:
                ns.status = "completed"
                ns.output = {"text": output_text}
                ns.next_branch = next_branch_val
                ns.completed_at = datetime.now(timezone.utc)
                await db.commit()

            chosen_edge = next((edge for edge in _edges if edge["target"] == next_branch_val), None)
            if next_branch_val and len(_targets) > 1:
                next_target_visit = int((state.get("node_visit_counts") or {}).get(next_branch_val) or 0) + 1
                loop_back = next_target_visit > 1
                branch_label = str((chosen_edge or {}).get("condition_label") or "").strip()
                db.add(RunWorklogEntry(
                    id=uuid4(),
                    run_id=run_id,
                    node_id=node_id,
                    agent_ref=agent_ref,
                    entry_type="action",
                    content=(
                        f"Selected branch to {next_branch_val}"
                        + (f" — {branch_label}" if branch_label else "")
                        + (f". Returning for visit {next_target_visit}." if loop_back else "")
                    ),
                    metadata_={
                        "kind": "branch_selected",
                        "next_branch": next_branch_val,
                        "branch_label": branch_label or None,
                        "visit_index": current_visit,
                        "max_visits": MAX_NODE_VISITS_PER_RUN,
                        "loop_back": loop_back,
                        "next_target_visit": next_target_visit,
                    },
                ))
                await db.commit()

        await publish_event(state["run_id"], {
            "type": "node_completed",
            "node_id": node_id,
            "status": "completed",
        })

        return {
            "current_output": output_text,
            "node_outputs": {node_id: output_text},
            "node_visit_counts": {node_id: current_visit},
            "next_branch": next_branch_val,
            "messages": [{"role": "assistant", "content": output_text, "node_id": node_id}],
        }

    return node_fn

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
    from ..engine import RunState


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


def _build_participant_escalation_question(
    *,
    node_name: str,
    config: dict,
    retry_guidance: str | None = None,
) -> str:
    if retry_guidance:
        retry_line = next((line.strip() for line in str(retry_guidance).splitlines() if line.strip()), "")
        if retry_line:
            return retry_line
    question = str(config.get("question") or "").strip()
    if question:
        return question
    instruction = str(config.get("system_prompt") or config.get("prompt") or "").strip()
    if instruction:
        first_line = next((line.strip() for line in instruction.splitlines() if line.strip()), "")
        if first_line:
            return first_line
    return (
        f"Complete '{node_name}'. "
        "If required input is missing, ask one specific clarifying question."
    )


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
    from libs.database import AsyncSessionLocal
    from modules.workflows.backend.runs.models import RunNodeState
    from modules.workflows.backend.runs.human_review import create_run_escalation, supersede_open_node_escalations

    async with AsyncSessionLocal() as db:
        ns = await db.get(RunNodeState, ns_id)
        if ns is not None:
            ns.status = "paused"
            ns.completed_at = datetime.now(timezone.utc)
            await db.commit()

        await supersede_open_node_escalations(db, run_id=run_id, node_id=node_id)

        esc = await create_run_escalation(
            db,
            run_id=run_id,
            run_node_state_id=ns_id,
            workspace_id=UUID(workspace_id),
            type="agent_question",
            context=context,
            assigned_to=recipients,
            publish_event=False,
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

        from core.api import channels as core_channels
        from modules.communication.backend.channels_schemas import ChannelMessageCreate
        from libs.database import AsyncSessionLocal
        from libs.participants import resolve_participant_ids
        from ..events import publish_event
        from ..knowledge_loader import KnowledgeTree, load_knowledge_tree
        from modules.workflows.backend.runs.models import RunNodeState, RunWorklogEntry

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
        if not operator_id or not supervisor_id:
            raise RuntimeError(f"Node '{node_name}' requires both operator_id and supervisor_id")
        async with AsyncSessionLocal() as db:
            operator_recipients = await resolve_participant_ids(
                db,
                UUID(workspace_id),
                [participant_id for participant_id in [operator_id] if participant_id],
            )
            supervisor_recipients = await resolve_participant_ids(
                db,
                UUID(workspace_id),
                [participant_id for participant_id in [supervisor_id] if participant_id],
            )
        if not operator_recipients:
            raise RuntimeError(f"Node '{node_name}' operator '{operator_id}' is not resolvable in this workspace")
        if not supervisor_recipients:
            raise RuntimeError(f"Node '{node_name}' supervisor '{supervisor_id}' is not resolvable in this workspace")
        operator_participant_id = operator_recipients[0]
        supervisor_participant_id = supervisor_recipients[0]
        recipients = operator_recipients
        request_target_role = "operator"

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

            if ns_id is None:
                raise RuntimeError("Node state ID not set")

            question_text = _build_participant_escalation_question(
                node_name=node_name,
                config=config,
                retry_guidance=retry_guidance,
            )
            escalation_id = await _create_participant_escalation(
                ns_id=ns_id,
                run_id=run_id,
                node_id=node_id,
                workspace_id=workspace_id,
                recipients=recipients,
                context={
                    "questions": [question_text],
                    "prompt": prompt,
                    "messages": [prompt],
                    "node_id": node_id,
                    "operator_id": operator_id,
                    "supervisor_id": supervisor_id,
                    "participant_ids": recipients,
                },
            )

            async with AsyncSessionLocal() as db:
                run_channel = await core_channels.get_or_create_run_channel(
                    db,
                    workspace_id=UUID(workspace_id),
                    run_id=run_id,
                    graph_id=UUID(str(state["graph_id"])) if state.get("graph_id") else None,
                    participant_ids=None,
                )
                await core_channels.create_message(
                    db,
                    workspace_id=UUID(workspace_id),
                    channel_id=run_channel.id,
                    data=ChannelMessageCreate(
                        role="assistant",
                        author_type="system",
                        author_name=f"Workflow Orchestrator · {node_name}",
                        content=question_text,
                        run_id=run_id,
                        node_id=node_id,
                        metadata={
                            "kind": "request",
                            "request": {
                                "type": "agent_question",
                                "status": "open",
                                "questions": [question_text],
                                "context_markdown": prompt,
                                "response_schema": {
                                    "resolution_options": [
                                        "accept_output",
                                        "override_output",
                                        "request_revision",
                                        "abort_run",
                                    ],
                                    "supports_guidance": True,
                                    "supports_answers": True,
                                    "supports_override_output": True,
                                    "supports_next_branch": True,
                                },
                                "assigned_to": recipients,
                                "escalation_id": str(escalation_id),
                            },
                            "flow": {
                                "protocol": "knotwork.orchestrated_message/v1",
                                "from_role": "orchestrator",
                                "from_kind": "langgraph_machine",
                                "to_role": request_target_role,
                                "to_participant_ids": recipients,
                                "about": "node_input_request",
                                "run_id": run_id,
                                "node_id": node_id,
                                "escalation_id": str(escalation_id),
                            },
                            "operator_id": operator_id,
                            "supervisor_id": supervisor_id,
                            "assigned_to": recipients,
                            "orchestrator": {
                                "kind": "workflow",
                                "workflow_id": str(state.get("graph_id") or ""),
                                "run_id": run_id,
                                "mission": "Guide the channel conversation through the workflow and request human input when needed.",
                            },
                        },
                    ),
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

                actor_participant_id = str(resolution.get("actor_participant_id") or "").strip()
                inferred_actor_role = request_target_role
                if actor_participant_id == operator_participant_id:
                    inferred_actor_role = "operator"
                elif actor_participant_id == supervisor_participant_id:
                    inferred_actor_role = "supervisor"

                if resolution_type == "request_revision":
                    if inferred_actor_role == "operator":
                        # Operator requested supervision.
                        recipients = supervisor_recipients
                        request_target_role = "supervisor"
                        retry_guidance = (
                            resolved_text
                            or "Operator requested supervision. Provide a decisive review instruction."
                        )
                        continue
                    if inferred_actor_role == "supervisor":
                        # Supervisor requested operator rework.
                        recipients = operator_recipients
                        request_target_role = "operator"
                        retry_guidance = (
                            resolved_text
                            or "Supervisor requested revision. Rework and return decisive output."
                        )
                        continue

                retry_guidance = resolved_text or "Please provide decisive task output."
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

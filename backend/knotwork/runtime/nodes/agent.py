"""
Generic agent node — delegates execution to a pluggable AgentAdapter.

agent_ref values: "human" | "openclaw"
Specific agent identified by registered_agent_id on node_def (DB lookup).
trust_level: float 0.0–1.0 (0=always ask human, 1=fully autonomous).
outgoing_targets: passed from engine at compile time for multi-branch routing hint.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

if TYPE_CHECKING:
    from knotwork.runtime.engine import RunState

# run_id in RunState is a plain string (12-char hex or legacy 36-char UUID string).
MAX_NODE_VISITS_PER_RUN = 5


def _resolve_agent_ref(node_def: dict) -> str:
    """Return 'human' or 'openclaw' for the unified agent node."""
    ref = (node_def.get("agent_ref") or "").strip()
    if ref == "human":
        return "human"
    return "openclaw"


def _trust_level_to_float(node_def: dict) -> float:
    """Map trust_level to float 0.0–1.0. Accepts float or legacy string enum."""
    val = node_def.get("trust_level")
    if isinstance(val, (int, float)):
        return float(max(0.0, min(1.0, val)))
    return {"user_controlled": 0.0, "supervised": 0.5, "autonomous": 1.0}.get(str(val or ""), 0.5)


def _build_routing_block(edges: list[dict], targets: list[str]) -> str:
    branch_lines = "\n".join(
        f'  - "{e["target"]}": evaluate → {e["condition_label"] or "(no condition)"}'
        for e in edges
    )
    return (
        f"=== ROUTING ===\n"
        f"After completing your work you MUST choose exactly one next step "
        f"by setting 'next_branch' in your decision block.\n"
        f"For each branch, evaluate the condition and pick the matching one:\n"
        f"{branch_lines}"
    )


def _build_completion_protocol(targets: list[str]) -> str:
    next_branch_example = targets[0] if targets else "next-node-id"
    target_rule = (
        f"one of: {', '.join(repr(t) for t in targets)}"
        if targets else "(only one path — omit or set null)"
    )
    return (
        f"=== COMPLETION PROTOCOL ===\n"
        f"You MUST end every response with a fenced ```json-decision block.\n"
        f"Choose ONE of the two forms:\n\n"
        f"Confident — work is done, proceed:\n"
        f"```json-decision\n"
        f"{{\"decision\": \"confident\", \"output\": \"<your answer here>\", \"next_branch\": \"{next_branch_example}\"}}\n"
        f"```\n\n"
        f"Escalate — you need human input before proceeding:\n"
        f"```json-decision\n"
        f"{{\"decision\": \"escalate\", \"questions\": [\"<question 1>\", \"<question 2>\"]}}\n"
        f"```\n\n"
        f"Rules:\n"
        f"- `output` is your full answer; it will be passed to the next node.\n"
        f"- `next_branch` must be {target_rule}.\n"
        f"- `questions` is a list of strings — one entry per distinct question.\n"
        f"- Use `escalate` when trust ≤ 0.3 or when genuinely uncertain; "
        f"use `confident` when trust ≥ 0.7 and the answer is clear.\n"
        f"- Do NOT add any text after the closing ``` of the block."
    )


def _build_tail_blocks(edges: list[dict], targets: list[str]) -> str:
    """ROUTING (if multi-branch) + COMPLETION PROTOCOL — appended to user_prompt."""
    parts = []
    if len(targets) > 1:
        parts.append(_build_routing_block(edges, targets))
    parts.append(_build_completion_protocol(targets))
    return "\n\n".join(parts)


def _build_retry_user_prompt(raw_guidance: str, edges: list[dict], targets: list[str]) -> str:
    """Retry after escalation: human intervention + routing + completion. No system_prompt."""
    return f"=== HUMAN INTERVENTION ===\n{raw_guidance}\n\n{_build_tail_blocks(edges, targets)}"


def _strip_trailing_decision_block(text: str) -> str:
    """Remove trailing ```json-decision fenced block if present."""
    if not text:
        return text
    fence = "```json-decision"
    start = text.rfind(fence)
    if start == -1:
        return text
    newline = text.find("\n", start)
    if newline == -1:
        return text
    end = text.find("```", newline + 1)
    if end == -1:
        return text
    if text[end + 3:].strip():
        return text
    return text[:start].rstrip()


def make_agent_node(node_def: dict, outgoing_edges: list[dict] | None = None):
    """
    Factory returning an async LangGraph node function.
    outgoing_edges: list of {target: str, condition_label: str|None} from engine compile.
    Each edge with >1 sibling must have a condition_label (validated before run starts).
    """
    node_id: str = node_def["id"]
    node_name: str = node_def.get("name") or node_id
    config: dict = node_def.get("config") or {}
    knowledge_files: list[str] = config.get("knowledge_paths") or config.get("knowledge_files", [])
    supervisor_id = str(node_def.get("supervisor_id") or "").strip() or None

    # Pre-compute edge list once — used in every prompt build inside node_fn
    _edges: list[dict] = outgoing_edges or []
    _targets: list[str] = [e["target"] for e in _edges]

    async def node_fn(state: "RunState") -> dict:
        from knotwork.channels import service as channel_service
        from knotwork.channels.schemas import ChannelMessageCreate
        from knotwork.agent_api.session import create_session_token
        from knotwork.config import settings
        from knotwork.database import AsyncSessionLocal
        from knotwork.runtime.adapters import get_adapter
        from knotwork.runtime.events import publish_event
        from knotwork.runtime.knowledge_loader import KnowledgeTree, load_knowledge_tree
        from knotwork.runs.models import OpenAICallLog, RunHandbookProposal, RunNodeState, RunWorklogEntry

        run_id = str(state["run_id"])
        workspace_id = state["workspace_id"]
        agent_ref = _resolve_agent_ref(node_def)
        trust = _trust_level_to_float(node_def)
        visit_counts = state.get("node_visit_counts") or {}
        current_visit = int(visit_counts.get(node_id) or 0) + 1
        if current_visit > MAX_NODE_VISITS_PER_RUN:
            from knotwork.database import AsyncSessionLocal
            from knotwork.runs.models import RunWorklogEntry

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

        # Fetch registered agent credentials
        api_key: str | None = None
        registered_agent_id = node_def.get("registered_agent_id")
        if registered_agent_id and agent_ref == "openclaw":
            from knotwork.registered_agents.models import RegisteredAgent
            async with AsyncSessionLocal() as db:
                ra = await db.get(RegisteredAgent, UUID(str(registered_agent_id)))
                is_active = False
                if ra:
                    if getattr(ra, "status", None):
                        is_active = ra.status == "active"
                    else:
                        is_active = bool(getattr(ra, "is_active", False))
                if ra and is_active:
                    api_key = ra.api_key

        tree = (
            await load_knowledge_tree(knowledge_files, workspace_id)
            if knowledge_files else KnowledgeTree()
        )

        retry_guidance: str | None = None
        handled_by_human = False
        output_text = ""
        next_branch_val: str | None = None
        ns_id: UUID | None = None
        session_token: str | None = None
        continue_same_attempt = False
        accept_without_retry = False
        openai_log_row_id: UUID | None = None

        # ── Pre-seed retry_guidance on LangGraph re-runs ─────────────────────
        # LangGraph re-executes the node from scratch on resume, resetting local
        # variables. Without this, the adapter runs once without the human's
        # answers, wasting a full agent round-trip. We detect the resume by
        # checking for a resolved request_revision escalation in the DB and
        # reuse the existing paused RunNodeState so human_guidance is visible
        # in the debug from the very first adapter call.
        async with AsyncSessionLocal() as db:
            from sqlalchemy import select as sa_select
            from knotwork.escalations.models import Escalation

            # node_id lives in context JSON, not a column — filter in Python
            _seed_rows = (await db.execute(
                sa_select(Escalation)
                .where(
                    Escalation.run_id == run_id,
                    Escalation.resolution == "request_revision",
                    Escalation.status == "resolved",
                )
                .order_by(Escalation.resolved_at.desc())
            )).scalars().all()
            _seed_esc = next(
                (e for e in _seed_rows if (e.context or {}).get("node_id") == node_id),
                None,
            )
            if _seed_esc:
                # Only activate if the node is currently paused (genuine resume).
                # Guards against incorrectly seeding answers on a fresh iteration
                # of a node that was previously escalated in the same run.
                _ns_result = await db.execute(
                    sa_select(RunNodeState)
                    .where(
                        RunNodeState.run_id == run_id,
                        RunNodeState.node_id == node_id,
                        RunNodeState.status == "paused",
                    )
                    .limit(1)
                )
                _paused_ns = _ns_result.scalar_one_or_none()
                if _paused_ns:
                    _rd = _seed_esc.resolution_data or {}
                    _seed_answers: list = _rd.get("answers") or []
                    _seed_questions: list = (_seed_esc.context or {}).get("questions") or []
                    _seed_guidance: str = (_rd.get("guidance") or "").strip()
                    if _seed_answers and _seed_questions:
                        _parts = [
                            f"Q: {q}\nA: {a}"
                            for q, a in zip(_seed_questions, _seed_answers) if a
                        ]
                        retry_guidance = "\n\n".join(_parts) if _parts else None
                    if not retry_guidance and _seed_guidance:
                        retry_guidance = _seed_guidance
                    if retry_guidance:
                        ns_id = _paused_ns.id
                        continue_same_attempt = True

        while True:
            # ── Session token ────────────────────────────────────────────────
            if not (continue_same_attempt and session_token):
                session_token = create_session_token(
                    str(run_id), node_id, workspace_id, settings.jwt_secret
                )
            if session_token is None:
                raise RuntimeError("Session token not set")

            attempt_node_def = {**node_def, "config": dict(config)}
            adapter = get_adapter(agent_ref, api_key=api_key)

            # ── RunNodeState row ─────────────────────────────────────────────
            if continue_same_attempt and ns_id is not None:
                async with AsyncSessionLocal() as db:
                    ns = await db.get(RunNodeState, ns_id)
                    if ns:
                        ns.status = "running"
                        ns.completed_at = None
                        merged = dict(ns.input or {})
                        merged.update({
                            "model": agent_ref,
                            "system_prompt": "",  # filled when adapter yields started
                            "user_prompt": "",    # filled when adapter yields started
                            "run_input": state.get("input"),
                            "prior_outputs": None,
                            "human_guidance": retry_guidance,
                            "session_token": session_token,
                            "visit_index": current_visit,
                            "max_visits": MAX_NODE_VISITS_PER_RUN,
                            "is_repeat_visit": current_visit > 1,
                        })
                        ns.input = merged
                        await db.commit()
                continue_same_attempt = False
            else:
                async with AsyncSessionLocal() as db:
                    ns = RunNodeState(
                        id=uuid4(), run_id=run_id, node_id=node_id, node_name=node_name,
                        agent_ref=agent_ref, status="running",
                        input={
                            "model": agent_ref,
                            "system_prompt": "",  # filled when adapter yields started
                            "user_prompt": "",    # filled when adapter yields started
                            "run_input": state.get("input"),
                            "prior_outputs": None,
                            "human_guidance": retry_guidance,
                            "session_token": session_token,
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

            # ── Run adapter, collect events ──────────────────────────────────
            _current_retry = retry_guidance   # snapshot before reset
            retry_guidance = None
            accept_without_retry = False
            _fail_error: str | None = None
            pending_escalations: list[dict] = []

            async for event in adapter.run_node(
                attempt_node_def, state, tree, session_token,
                outgoing_edges=_edges,
                targets=_targets,
                trust=trust,
                retry_guidance=_current_retry,
            ):
                if event.type == "log_entry":
                    p = event.payload
                    async with AsyncSessionLocal() as db:
                        db.add(RunWorklogEntry(
                            id=uuid4(), run_id=run_id, node_id=node_id, agent_ref=agent_ref,
                            entry_type=p.get("entry_type", "observation"),
                            content=p.get("content", ""), metadata_=p.get("metadata", {}),
                        ))
                        progress_text = str(p.get("content") or "").strip()
                        if progress_text:
                            run_channel = await channel_service.get_or_create_run_channel(
                                db, workspace_id=UUID(workspace_id), run_id=run_id,
                                graph_id=UUID(str(state["graph_id"])) if state.get("graph_id") else None,
                            )
                            await channel_service.create_message(
                                db, workspace_id=UUID(workspace_id), channel_id=run_channel.id,
                                data=ChannelMessageCreate(
                                    role="system", author_type="system", author_name=node_name,
                                    content=progress_text, run_id=run_id, node_id=node_id,
                                    metadata={"kind": "agent_progress",
                                              "entry_type": p.get("entry_type", "observation"),
                                              "agent_ref": agent_ref, "details": p.get("metadata", {})},
                                ),
                            )
                        await db.commit()

                elif event.type == "proposal":
                    p = event.payload
                    async with AsyncSessionLocal() as db:
                        db.add(RunHandbookProposal(
                            id=uuid4(), run_id=run_id, node_id=node_id, agent_ref=agent_ref,
                            path=p["path"], proposed_content=p["proposed_content"],
                            reason=p["reason"], status="pending",
                        ))
                        await db.commit()

                elif event.type == "escalation":
                    # Collect — do NOT interrupt here; all escalations will be
                    # grouped into one interrupt after the generator finishes.
                    pending_escalations.append(event.payload)

                elif event.type == "completed":
                    output_text = _strip_trailing_decision_block(
                        str(event.payload.get("output", ""))
                    )
                    next_branch_val = event.payload.get("next_branch")
                    break

                elif event.type == "failed":
                    _fail_error = event.payload.get("error", "adapter failed")
                    break

                elif event.type == "started":
                    # Adapter reports the actual prompts it used — update RunNodeState.
                    sys_p = event.payload.get("system_prompt", "")
                    usr_p = event.payload.get("user_prompt", "")
                    if (sys_p or usr_p) and ns_id is not None:
                        async with AsyncSessionLocal() as db:
                            ns2 = await db.get(RunNodeState, ns_id)
                            if ns2:
                                merged = dict(ns2.input or {})
                                merged["system_prompt"] = sys_p
                                merged["user_prompt"] = usr_p
                                ns2.input = merged
                                await db.commit()

                elif event.type == "provider_started":
                    if event.payload.get("provider") != "openai":
                        continue
                    openai_ids = {
                        "assistant_id": str(event.payload.get("assistant_id") or ""),
                        "thread_id": str(event.payload.get("thread_id") or ""),
                        "run_id": str(event.payload.get("openai_run_id") or ""),
                    }
                    async with AsyncSessionLocal() as db:
                        ns2 = await db.get(RunNodeState, ns_id)
                        if ns2:
                            merged = dict(ns2.input or {})
                            merged["openai_ids"] = openai_ids
                            ns2.input = merged
                            await db.commit()
                        workflow_uuid = None
                        if state.get("graph_id"):
                            try:
                                workflow_uuid = UUID(str(state["graph_id"]))
                            except Exception:
                                pass
                        row = OpenAICallLog(
                            id=uuid4(), workspace_id=UUID(workspace_id),
                            workflow_id=workflow_uuid, run_id=run_id,
                            run_node_state_id=ns_id, node_id=node_id, agent_ref=agent_ref,
                            provider="openai",
                            openai_assistant_id=openai_ids["assistant_id"] or None,
                            openai_thread_id=openai_ids["thread_id"] or None,
                            openai_run_id=openai_ids["run_id"] or None,
                            request_payload=event.payload.get("request", {}),
                            response_payload=None, status="started",
                            updated_at=datetime.now(timezone.utc),
                        )
                        db.add(row)
                        await db.commit()
                        openai_log_row_id = row.id

                elif event.type == "provider_finished":
                    if event.payload.get("provider") != "openai":
                        continue
                    async with AsyncSessionLocal() as db:
                        row = await db.get(OpenAICallLog, openai_log_row_id) if openai_log_row_id else None
                        if row is None and event.payload.get("openai_run_id"):
                            from sqlalchemy import select
                            q = await db.execute(
                                select(OpenAICallLog)
                                .where(OpenAICallLog.openai_run_id == str(event.payload.get("openai_run_id")))
                                .order_by(OpenAICallLog.created_at.desc())
                            )
                            row = q.scalars().first()
                        if row:
                            row.status = str(event.payload.get("status") or "completed")
                            row.response_payload = event.payload.get("response", {})
                            row.updated_at = datetime.now(timezone.utc)
                            await db.commit()

            # Propagate adapter failure after generator closes cleanly.
            if _fail_error:
                raise RuntimeError(_fail_error)

            # ── Handle grouped escalations ───────────────────────────────────
            if pending_escalations:
                all_questions: list[str] = []
                all_messages: list[str] = []
                for esc_payload in pending_escalations:
                    qs = esc_payload.get("questions") or (
                        [esc_payload["question"]] if esc_payload.get("question") else []
                    )
                    all_questions.extend([q for q in qs if q])
                    out = esc_payload.get("output") or esc_payload.get("message")
                    if out:
                        all_messages.append(str(out))

                if all_messages and ns_id is not None:
                    async with AsyncSessionLocal() as db:
                        ns2 = await db.get(RunNodeState, ns_id)
                        if ns2:
                            ns2.output = {"text": "\n\n".join(all_messages)}
                            await db.commit()

                grouped_payload = {
                    "questions": all_questions,
                    "messages": all_messages,
                    "node_id": node_id,
                }
                await _handle_escalation(
                    ns_id, run_id, node_id, workspace_id, grouped_payload, agent_ref, supervisor_id
                )
                await publish_event(
                    state["run_id"], {"type": "escalation_created", "node_id": node_id}
                )

                from langgraph.types import interrupt
                resolution = interrupt({
                    "reason": "escalation",
                    "node_id": node_id,
                    "questions": all_questions,
                })
                resolution = resolution if isinstance(resolution, dict) else {}
                resolution_type = resolution.get("resolution") or "accept_output"
                # Normalise legacy resolution names
                if resolution_type == "approved":
                    resolution_type = "accept_output"
                elif resolution_type == "edited":
                    resolution_type = "override_output"
                elif resolution_type == "guided":
                    resolution_type = "request_revision"
                elif resolution_type == "aborted":
                    resolution_type = "abort_run"

                if resolution_type == "override_output":
                    edited = resolution.get("override_output") or resolution.get("edited_output")
                    if isinstance(edited, dict):
                        output_text = str(edited.get("text") or edited)
                    else:
                        output_text = str(edited or "")
                    handled_by_human = True
                    break

                if resolution_type == "accept_output":
                    output_text = _strip_trailing_decision_block(
                        "\n\n".join(all_messages) if all_messages else output_text
                    )
                    accept_without_retry = True
                    break

                if resolution_type == "request_revision":
                    answers: list = resolution.get("answers") or []
                    if answers and all_questions:
                        parts = []
                        for i, q in enumerate(all_questions):
                            ans = answers[i] if i < len(answers) else ""
                            if ans:
                                parts.append(f"Q: {q}\nA: {ans}")
                        retry_guidance = "\n\n".join(parts) if parts else None
                    else:
                        g = resolution.get("guidance")
                        retry_guidance = str(g).strip() if g else None
                    continue_same_attempt = True
                    continue  # loop back for retry

                raise RuntimeError("Run resumed with unsupported escalation resolution")

            # ── Routing escalation: agent finished but gave no branch ────────
            if len(_targets) > 1 and not next_branch_val and output_text:
                routing_payload = {
                    "questions": [],
                    "messages": [
                        "The agent completed its work but did not specify which branch "
                        "to take. Please review the output and choose the next step."
                    ],
                    "options": _targets,
                    "node_id": node_id,
                }
                await _handle_escalation(
                    ns_id, run_id, node_id, workspace_id, routing_payload, agent_ref, supervisor_id
                )
                await publish_event(
                    state["run_id"], {"type": "escalation_created", "node_id": node_id}
                )

                from langgraph.types import interrupt
                resolution = interrupt({"reason": "routing_escalation", "node_id": node_id})
                resolution = resolution if isinstance(resolution, dict) else {}
                resolution_type = resolution.get("resolution") or "accept_output"

                if resolution_type == "accept_output":
                    chosen = resolution.get("next_branch")
                    next_branch_val = chosen if chosen in _targets else _targets[0]
                elif resolution_type == "request_revision":
                    g = resolution.get("guidance") or ""
                    retry_guidance = g or (
                        f"You must route to one of: {', '.join(_targets)}. "
                        f"Review your output and choose the correct branch."
                    )
                    continue_same_attempt = True
                    continue
                elif resolution_type == "abort_run":
                    raise RuntimeError("Run aborted during routing escalation")
                else:
                    next_branch_val = _targets[0]

            break  # no escalation — completed normally

        # ── Persist final node state ─────────────────────────────────────────
        if ns_id is None:
            raise RuntimeError("Node state ID not set")

        async with AsyncSessionLocal() as db:
            ns2 = await db.get(RunNodeState, ns_id)
            if ns2:
                ns2.status = "completed"
                ns2.output = {"text": output_text}
                ns2.next_branch = next_branch_val
                ns2.completed_at = datetime.now(timezone.utc)
                await db.commit()

            chosen_edge = next((edge for edge in _edges if edge["target"] == next_branch_val), None)
            if next_branch_val and len(_targets) > 1:
                next_target_visit = int((state.get("node_visit_counts") or {}).get(next_branch_val) or 0) + 1
                loop_back = next_target_visit > 1
                branch_label = str((chosen_edge or {}).get("condition_label") or "").strip()
                content = (
                    f"Selected branch to {next_branch_val}"
                    + (f" — {branch_label}" if branch_label else "")
                    + (f". Returning for visit {next_target_visit}." if loop_back else "")
                )
                db.add(RunWorklogEntry(
                    id=uuid4(),
                    run_id=run_id,
                    node_id=node_id,
                    agent_ref=agent_ref,
                    entry_type="action",
                    content=content,
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

            if output_text:
                run_channel = await channel_service.get_or_create_run_channel(
                    db, workspace_id=UUID(workspace_id), run_id=run_id,
                    graph_id=UUID(str(state["graph_id"])) if state.get("graph_id") else None,
                )
                await channel_service.create_message(
                    db, workspace_id=UUID(workspace_id), channel_id=run_channel.id,
                    data=ChannelMessageCreate(
                        role="assistant", author_type="agent", author_name=node_name,
                        content=output_text, run_id=run_id, node_id=node_id,
                        metadata={"kind": "node_output", "agent_ref": agent_ref},
                    ),
                )

        await publish_event(state["run_id"], {
            "type": "node_completed", "node_id": node_id, "status": "completed",
        })

        return {
            "current_output": output_text,
            "node_outputs": {node_id: output_text},
            "node_visit_counts": {node_id: current_visit},
            "next_branch": next_branch_val,
            "messages": [{"role": "assistant", "content": output_text, "node_id": node_id}],
        }

    return node_fn


async def _handle_escalation(
    ns_id: UUID | None, run_id: str, node_id: str, workspace_id: str,
    payload: dict, agent_ref: str, supervisor_id: str | None,
) -> None:
    from sqlalchemy import update

    from knotwork.channels import service as channel_service
    from knotwork.channels.schemas import ChannelMessageCreate
    from knotwork.database import AsyncSessionLocal
    from knotwork.escalations.models import Escalation
    from knotwork.escalations.service import create_escalation
    from knotwork.runs.models import RunNodeState

    questions: list[str] = payload.get("questions") or []
    messages: list[str] = payload.get("messages") or []

    async with AsyncSessionLocal() as db:
        if ns_id is not None:
            ns = await db.get(RunNodeState, ns_id)
            if ns:
                ns.status = "paused"
                ns.completed_at = datetime.now(timezone.utc)
                await db.commit()

        # Supersede any stale open escalations for this run
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

        await create_escalation(
            db, run_id=run_id,
            run_node_state_id=ns_id if ns_id is not None else UUID(int=0),
            workspace_id=UUID(workspace_id),
            type="human_checkpoint" if agent_ref == "human" else "agent_question",
            context={
                "questions": questions,
                "messages": messages,
                "node_id": node_id,
                "supervisor_id": supervisor_id,
            },
            assigned_to=[supervisor_id] if supervisor_id else None,
        )

        # Post each question as a channel message
        for question in questions:
            if not question:
                continue
            run_channel = await channel_service.get_or_create_run_channel(
                db, workspace_id=UUID(workspace_id), run_id=run_id, graph_id=None,
            )
            await channel_service.create_message(
                db, workspace_id=UUID(workspace_id), channel_id=run_channel.id,
                data=ChannelMessageCreate(
                    role="assistant", author_type="agent", author_name=node_id,
                    content=question, run_id=run_id, node_id=node_id,
                    metadata={"kind": "escalation_question", "agent_ref": agent_ref},
                ),
            )

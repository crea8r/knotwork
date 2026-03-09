"""
Generic agent node — delegates execution to a pluggable AgentAdapter.

Replaces llm_agent and human_checkpoint node functions.
Handles all NodeEvent types: log_entry, proposal, escalation, completed, failed.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

if TYPE_CHECKING:
    from knotwork.runtime.engine import RunState


def _resolve_agent_ref(node_def: dict, default_model: str) -> str:
    """Determine agent_ref from node_def, with legacy type fallbacks."""
    if node_def.get("agent_ref"):
        return node_def["agent_ref"]
    legacy_type = node_def.get("type")
    if legacy_type == "human_checkpoint":
        return "human"
    if legacy_type == "llm_agent":
        model = (node_def.get("config") or {}).get("model") or default_model
        if model.startswith("anthropic") or model.startswith("claude"):
            name = model.removeprefix("anthropic/")
            return f"anthropic:{name}"
        name = model.removeprefix("openai/")
        return f"openai:{name}"
    # conditional_router and other legacy types default to the workspace model
    return f"anthropic:{default_model}" if "claude" in default_model else f"openai:{default_model}"


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
    if text[end + 3 :].strip():
        return text
    return text[:start].rstrip()


def make_agent_node(node_def: dict):
    """
    Factory returning an async LangGraph node function for any agent node.

    Works for the unified 'agent' type as well as legacy llm_agent /
    human_checkpoint / conditional_router types.
    """
    node_id: str = node_def["id"]
    node_name: str = node_def.get("name") or node_id
    config: dict = node_def.get("config") or {}
    knowledge_files: list[str] = config.get("knowledge_paths") or config.get("knowledge_files", [])
    confidence_rules: list[dict] = config.get("confidence_rules", [])
    checkpoints_cfg: list[dict] = config.get("checkpoints", [])
    confidence_threshold: float = float(config.get("confidence_threshold", 0.70))

    async def node_fn(state: "RunState") -> dict:
        from knotwork.channels import service as channel_service
        from knotwork.channels.schemas import ChannelMessageCreate
        from knotwork.agent_api.session import create_session_token
        from knotwork.config import settings
        from knotwork.database import AsyncSessionLocal
        from knotwork.runtime.adapters import get_adapter
        from knotwork.runtime.checkpoints import evaluate_checkpoints
        from knotwork.runtime.confidence import compute_confidence
        from knotwork.runtime.events import publish_event
        from knotwork.runtime.knowledge_loader import KnowledgeTree, load_knowledge_tree
        from knotwork.runs.models import OpenAICallLog, RunHandbookProposal, RunNodeState, RunWorklogEntry

        run_id = UUID(state["run_id"])
        workspace_id = state["workspace_id"]
        agent_ref = _resolve_agent_ref(node_def, settings.default_model)
        is_openclaw_agent = agent_ref.startswith("openclaw:")

        # S7.1: if a registered_agent_id is set, fetch the per-workspace API key
        api_key: str | None = None
        registered_agent_id = node_def.get("registered_agent_id")
        if registered_agent_id:
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
                    agent_ref = ra.agent_ref  # honour the registered model

        tree = (
            await load_knowledge_tree(knowledge_files, workspace_id)
            if knowledge_files
            else KnowledgeTree()
        )
        from knotwork.runtime.prompt_builder import build_agent_prompt

        # If human guidance is provided while resuming an agent question,
        # re-run the same node with this guidance appended to system instructions.
        retry_guidance: str | None = None
        handled_by_human = False
        output_text = ""
        next_branch_val: str | None = None
        ns_id: UUID | None = None
        openai_log_row_id: UUID | None = None
        openai_ids: dict[str, str] | None = None

        while True:
            all_outputs: dict = state.get("node_outputs") or {}
            input_sources: list[str] | None = config.get("input_sources")
            if input_sources is None:
                run_fields = state.get("input", {})
                prior_outputs = dict(all_outputs) if all_outputs else None
            else:
                run_fields = state.get("input", {}) if "run_input" in input_sources else {}
                selected = {nid: all_outputs[nid] for nid in input_sources if nid in all_outputs}
                prior_outputs = selected if selected else None

            system_prompt, user_prompt = build_agent_prompt(
                tree=tree,
                state_fields=run_fields,
                context_files=state.get("context_files", []),
                prior_outputs=prior_outputs,
            )
            # Per-run override (from RunTriggerModal) takes precedence over design-time config
            _node_prompts = (state.get("input") or {}).get("_node_system_prompts") or {}
            extra = str(_node_prompts[node_id]) if node_id in _node_prompts else (
                config.get("system_prompt") or config.get("instructions", "")
            )
            if extra:
                system_prompt = f"{system_prompt}\n\n{extra}"
            system_prompt = (
                f"{system_prompt}\n\n"
                "=== RUNTIME CONSTRAINTS ===\n"
                "Available tools: write_worklog, propose_handbook_update, escalate, complete_node.\n"
                "If the request is understandable, produce a best-effort answer with clear unknowns and call complete_node.\n"
                "Use escalate only when a critical blocker prevents any useful output."
            )
            if retry_guidance:
                if is_openclaw_agent:
                    # Continue the existing OpenClaw session with only the operator guidance.
                    user_prompt = retry_guidance
                else:
                    system_prompt = (
                        f"{system_prompt}\n\n"
                        "=== HUMAN GUIDANCE (from escalation resolution) ===\n"
                        f"{retry_guidance}"
                    )
                    user_prompt = (
                        f"{user_prompt}\n\n"
                        "### Human Guidance (latest)\n"
                        f"{retry_guidance}"
                    )

            session_token = create_session_token(
                str(run_id), node_id, workspace_id, settings.jwt_secret
            )

            # Feed adapter the augmented prompt instructions for this attempt.
            attempt_node_def = {**node_def, "config": dict(config)}
            if retry_guidance and not is_openclaw_agent:
                merged_extra = str(_node_prompts[node_id]) if node_id in _node_prompts else (
                    config.get("system_prompt") or config.get("instructions", "")
                )
                guidance_block = (
                    "=== HUMAN GUIDANCE (from escalation resolution) ===\n"
                    f"{retry_guidance}"
                )
                attempt_node_def["config"]["system_prompt"] = (
                    f"{merged_extra}\n\n{guidance_block}" if merged_extra else guidance_block
                )

            adapter = get_adapter(agent_ref, api_key=api_key)

            # New attempt row each time the node is (re)run.
            async with AsyncSessionLocal() as db:
                ns = RunNodeState(
                    id=uuid4(), run_id=run_id, node_id=node_id, node_name=node_name,
                    agent_ref=agent_ref, status="running",
                    input={
                        "model": agent_ref,
                        "system_prompt": system_prompt,
                        "user_prompt": user_prompt,
                        "run_input": state.get("input"),
                        "prior_outputs": prior_outputs,
                        "human_guidance": retry_guidance,
                        "session_token": session_token,
                    },
                    knowledge_snapshot=tree.version_snapshot,
                    started_at=datetime.now(timezone.utc),
                )
                db.add(ns)
                await db.commit()
                ns_id = ns.id

            escalated = False
            retry_guidance = None
            _fail_error: str | None = None  # set on "failed" event; raised after generator closes cleanly

            async for event in adapter.run_node(attempt_node_def, state, tree, session_token):
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
                                    role="system",
                                    author_type="system",
                                    author_name=node_name,
                                    content=progress_text,
                                    run_id=run_id,
                                    node_id=node_id,
                                    metadata={
                                        "kind": "agent_progress",
                                        "entry_type": p.get("entry_type", "observation"),
                                        "agent_ref": agent_ref,
                                        "details": p.get("metadata", {}),
                                    },
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
                    escalated = True
                    q = event.payload.get("question", "")
                    opts = event.payload.get("options", [])
                    # Store the full agent message body in the node state output so the
                    # debug panel can show the complete response, not just the question.
                    full_output = event.payload.get("output", "")
                    if full_output:
                        async with AsyncSessionLocal() as db:
                            ns2 = await db.get(RunNodeState, ns_id)
                            if ns2:
                                ns2.output = {"text": full_output}
                                await db.commit()
                    await _handle_escalation(ns_id, run_id, node_id, workspace_id, event.payload, agent_ref)
                    await publish_event(state["run_id"], {"type": "escalation_created", "node_id": node_id})

                    from langgraph.types import interrupt
                    resolution = interrupt({
                        "reason": "escalation",
                        "node_id": node_id,
                        "question": q,
                        "options": opts,
                    })
                    resolution = resolution if isinstance(resolution, dict) else {}
                    resolution_type = resolution.get("resolution") or "accept_output"
                    if resolution_type == "approved":
                        resolution_type = "accept_output"
                    elif resolution_type == "edited":
                        resolution_type = "override_output"
                    elif resolution_type == "guided":
                        resolution_type = "request_revision"
                    elif resolution_type == "aborted":
                        resolution_type = "abort_run"

                    if resolution_type == "override_output":
                        edited = resolution.get("override_output")
                        if edited is None:
                            edited = resolution.get("edited_output")
                        if isinstance(edited, dict):
                            output_text = str(edited.get("text") or edited)
                        else:
                            output_text = str(edited or "")
                        handled_by_human = True
                        break

                    # accept/request_revision continue same node as a chat continuation.
                    if resolution_type in ("accept_output", "request_revision"):
                        g = resolution.get("guidance")
                        retry_guidance = str(g).strip() if g else None
                        break

                    # abort path should be handled by escalation router (no resume call).
                    raise RuntimeError("Run resumed with unsupported escalation resolution")

                elif event.type == "completed":
                    output_text = _strip_trailing_decision_block(str(event.payload.get("output", "")))
                    next_branch_val = event.payload.get("next_branch")
                    break

                elif event.type == "failed":
                    async with AsyncSessionLocal() as db:
                        ns2 = await db.get(RunNodeState, ns_id)
                        if ns2:
                            ns2.status = "failed"
                            ns2.error = event.payload.get("error", "adapter error")
                            ns2.completed_at = datetime.now(timezone.utc)
                            await db.commit()
                    # Break instead of raise so the async generator closes cleanly before
                    # we propagate the error. Raising inside async for can cause
                    # "RuntimeError: generator didn't stop" to mask the real error.
                    _fail_error = event.payload.get("error", "adapter failed")
                    break

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
                        workflow_id_val = state.get("graph_id")
                        if workflow_id_val:
                            try:
                                workflow_uuid = UUID(str(workflow_id_val))
                            except Exception:
                                workflow_uuid = None
                        row = OpenAICallLog(
                            id=uuid4(),
                            workspace_id=UUID(workspace_id),
                            workflow_id=workflow_uuid,
                            run_id=run_id,
                            run_node_state_id=ns_id,
                            node_id=node_id,
                            agent_ref=agent_ref,
                            provider="openai",
                            openai_assistant_id=openai_ids["assistant_id"] or None,
                            openai_thread_id=openai_ids["thread_id"] or None,
                            openai_run_id=openai_ids["run_id"] or None,
                            request_payload=event.payload.get("request", {}),
                            response_payload=None,
                            status="started",
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

            # Propagate adapter failure now that the generator is fully closed.
            if _fail_error:
                raise RuntimeError(_fail_error)

            if escalated:
                # accept/request_revision retry same node; override_output completes it.
                if handled_by_human:
                    break
                continue
            break

        # Apply confidence + checkpoint rules from node config
        output_dict = {"text": output_text}
        if handled_by_human:
            confidence = 1.0
            failed_cps = []
        else:
            confidence = compute_confidence(1.0, confidence_rules, {"output": output_dict})
            failed_cps = evaluate_checkpoints(checkpoints_cfg, output_dict)
        needs_conf_escalation = confidence < confidence_threshold or bool(failed_cps)
        final_status = "escalated" if needs_conf_escalation else "completed"

        if ns_id is None:
            raise RuntimeError("Node state ID not set")
        async with AsyncSessionLocal() as db:
            ns2 = await db.get(RunNodeState, ns_id)
            if ns2:
                ns2.status = final_status
                ns2.output = output_dict
                ns2.next_branch = next_branch_val
                ns2.confidence_score = confidence
                ns2.completed_at = datetime.now(timezone.utc)
                await db.commit()

            if output_text:
                await channel_service.create_message(
                    db,
                    workspace_id=UUID(workspace_id),
                    channel_id=(
                        await channel_service.get_or_create_run_channel(
                            db,
                            workspace_id=UUID(workspace_id),
                            run_id=run_id,
                            graph_id=UUID(str(state["graph_id"])) if state.get("graph_id") else None,
                        )
                    ).id,
                    data=ChannelMessageCreate(
                        role="assistant",
                        author_type="agent",
                        author_name=node_name,
                        content=output_text,
                        run_id=run_id,
                        node_id=node_id,
                        metadata={"kind": "node_output", "agent_ref": agent_ref},
                    ),
                )

            if needs_conf_escalation:
                from knotwork.escalations.service import create_escalation
                reason = "low_confidence" if confidence < confidence_threshold else "checkpoint_failed"
                await create_escalation(
                    db, run_id=run_id, run_node_state_id=ns_id,
                    workspace_id=UUID(workspace_id), type="confidence",
                    context={"reason": reason, "confidence": confidence, "node_id": node_id,
                             "output": output_dict, "failed_checkpoints": failed_cps},
                )

        await publish_event(state["run_id"], {
            "type": "node_completed", "node_id": node_id,
            "status": final_status, "confidence": confidence,
        })

        if needs_conf_escalation:
            from langgraph.types import interrupt
            interrupt({"reason": "confidence", "node_id": node_id, "confidence": confidence})

        return {
            "current_output": output_text,
            "node_outputs": {node_id: output_text},
            "next_branch": next_branch_val,
            "messages": [{"role": "assistant", "content": output_text, "node_id": node_id}],
        }

    return node_fn


async def _handle_escalation(
    ns_id: UUID, run_id: UUID, node_id: str, workspace_id: str,
    payload: dict, agent_ref: str,
) -> None:
    from sqlalchemy import update

    from knotwork.database import AsyncSessionLocal
    from knotwork.channels import service as channel_service
    from knotwork.channels.schemas import ChannelMessageCreate
    from knotwork.escalations.models import Escalation
    from knotwork.escalations.service import create_escalation
    from knotwork.runs.models import RunNodeState

    async with AsyncSessionLocal() as db:
        ns = await db.get(RunNodeState, ns_id)
        if ns:
            ns.status = "paused"
            ns.completed_at = datetime.now(timezone.utc)
            await db.commit()
        # Keep at most one open escalation per run. If stale open escalations
        # exist (e.g., delayed queue resumes), mark them superseded before
        # creating the newest question.
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
            db, run_id=run_id, run_node_state_id=ns_id,
            workspace_id=UUID(workspace_id),
            type="human_checkpoint" if agent_ref == "human" else "agent_question",
            context={"question": payload.get("question", ""), "options": payload.get("options", []),
                     "node_id": node_id},
        )
        question = str(payload.get("question") or "").strip()
        if question:
            run_channel = await channel_service.get_or_create_run_channel(
                db,
                workspace_id=UUID(workspace_id),
                run_id=run_id,
                graph_id=None,
            )
            await channel_service.create_message(
                db,
                workspace_id=UUID(workspace_id),
                channel_id=run_channel.id,
                data=ChannelMessageCreate(
                    role="assistant",
                    author_type="agent",
                    author_name=node_id,
                    content=question,
                    run_id=run_id,
                    node_id=node_id,
                    metadata={
                        "kind": "escalation_question",
                        "options": payload.get("options", []),
                        "agent_ref": agent_ref,
                    },
                ),
            )

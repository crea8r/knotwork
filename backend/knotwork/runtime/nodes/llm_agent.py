"""
LLM Agent node: core reasoning node.

Loads knowledge, builds GUIDELINES/CASE prompt, calls the LLM, evaluates
confidence and checkpoints, writes RunNodeState, and escalates if needed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    from knotwork.runtime.engine import RunState


def _get_llm(model: str):
    """Route model string → LangChain chat model instance."""
    from knotwork.config import settings

    name = model.removeprefix("openai/").removeprefix("anthropic/")
    if model.startswith("anthropic/") or model.startswith("claude"):
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=name,
            temperature=0.1,
            api_key=settings.anthropic_api_key or None,  # type: ignore[arg-type]
        )
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=name,
        temperature=0.1,
        api_key=settings.openai_api_key or None,  # type: ignore[arg-type]
    )


def make_llm_agent_node(node_def: dict):
    """
    Factory returning an async LangGraph node function for an llm_agent node.

    Node config keys:
      model              — override workspace default model
      knowledge_paths    — list of handbook paths to load (also accepts knowledge_files)
      system_prompt      — extra system instructions appended after guidelines (also accepts instructions)
      confidence_rules   — list of {condition, set} rule dicts
      checkpoints        — list of checkpoint dicts
      confidence_threshold — float; default 0.70
    """
    node_id = node_def["id"]
    config = node_def.get("config", {})
    model_override: str | None = config.get("model")
    # Accept both frontend key (knowledge_paths) and legacy key (knowledge_files)
    knowledge_files: list[str] = config.get("knowledge_paths") or config.get("knowledge_files", [])
    # Accept both frontend key (system_prompt) and legacy key (instructions)
    extra_instructions: str = config.get("system_prompt") or config.get("instructions", "")
    # input_sources: list of "run_input" or node IDs to include in prompt context.
    # None = include everything available (default).
    input_sources: list[str] | None = config.get("input_sources")
    confidence_rules: list[dict] = config.get("confidence_rules", [])
    checkpoints_cfg: list[dict] = config.get("checkpoints", [])
    confidence_threshold: float = float(config.get("confidence_threshold", 0.70))

    async def node_fn(state: "RunState") -> dict:
        from langchain_core.messages import HumanMessage, SystemMessage

        from knotwork.config import settings
        from knotwork.database import AsyncSessionLocal
        from knotwork.runtime.checkpoints import evaluate_checkpoints
        from knotwork.runtime.confidence import compute_confidence
        from knotwork.runtime.events import publish_event
        from knotwork.runtime.knowledge_loader import KnowledgeTree, load_knowledge_tree
        from knotwork.runtime.prompt_builder import build_agent_prompt
        from knotwork.runs.models import RunNodeState

        run_id = UUID(state["run_id"])
        workspace_id = state["workspace_id"]

        model = model_override or settings.default_model
        llm = _get_llm(model)

        tree = (
            await load_knowledge_tree(knowledge_files, workspace_id)
            if knowledge_files
            else KnowledgeTree()
        )

        # Assemble context from configured input sources
        all_node_outputs: dict = state.get("node_outputs") or {}
        if input_sources is None:
            # Default: include run input + all outputs accumulated so far
            run_fields = state["input"]
            prior_outputs = dict(all_node_outputs) if all_node_outputs else None
        else:
            run_fields = state["input"] if "run_input" in input_sources else {}
            node_ids = [s for s in input_sources if s != "run_input"]
            selected = {nid: all_node_outputs[nid] for nid in node_ids if nid in all_node_outputs}
            prior_outputs = selected if selected else None

        system_prompt, user_prompt = build_agent_prompt(
            tree=tree,
            state_fields=run_fields,
            context_files=state["context_files"],
            prior_outputs=prior_outputs,
        )
        if extra_instructions:
            system_prompt = f"{system_prompt}\n\n{extra_instructions}"

        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        output_text = response.content if hasattr(response, "content") else str(response)
        output_dict: dict = {"text": output_text}

        confidence = compute_confidence(1.0, confidence_rules, {"output": output_dict})
        failed_cps = evaluate_checkpoints(checkpoints_cfg, output_dict)
        needs_escalation = confidence < confidence_threshold or bool(failed_cps)
        node_status = "escalated" if needs_escalation else "completed"

        # Capture everything sent to the LLM
        node_input = {
            "model": model,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "run_input": state["input"],
            "previous_output": state.get("current_output"),
        }

        async with AsyncSessionLocal() as db:
            ns = RunNodeState(
                run_id=run_id,
                node_id=node_id,
                status=node_status,
                input=node_input,
                output=output_dict,
                confidence_score=confidence,
                started_at=datetime.now(timezone.utc),
                completed_at=datetime.now(timezone.utc),
            )
            db.add(ns)
            await db.commit()
            await db.refresh(ns)

            if needs_escalation:
                from knotwork.escalations.service import create_escalation
                reason = (
                    "low_confidence" if confidence < confidence_threshold
                    else "checkpoint_failed"
                )
                await create_escalation(
                    db,
                    run_id=run_id,
                    run_node_state_id=ns.id,
                    workspace_id=UUID(workspace_id),
                    type="confidence",
                    context={
                        "reason": reason,
                        "confidence": confidence,
                        "node_id": node_id,
                        "output": output_dict,
                        "failed_checkpoints": failed_cps,
                    },
                )

        await publish_event(state["run_id"], {
            "type": "node_completed",
            "node_id": node_id,
            "status": node_status,
            "confidence": confidence,
        })

        if needs_escalation:
            from langgraph.types import interrupt
            interrupt({
                "reason": "confidence" if confidence < confidence_threshold else "checkpoint",
                "node_id": node_id,
                "confidence": confidence,
            })

        return {
            "current_output": output_text,
            "node_outputs": {node_id: output_text},
            "messages": [{"role": "assistant", "content": output_text, "node_id": node_id}],
        }

    return node_fn

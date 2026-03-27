"""
Claude adapter — uses the Anthropic SDK directly (not LangChain).

Runs a tool-calling loop until the agent calls complete_node.
Knotwork-native tools are injected as Claude tools; the agent
uses them to log observations, propose handbook edits, escalate, or
signal completion.
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, AsyncGenerator
from uuid import UUID

from knotwork.database import AsyncSessionLocal
from knotwork.projects.service import render_project_context
from knotwork.runtime.adapters.base import AgentAdapter, NodeEvent
from knotwork.runtime.adapters.tools import KNOTWORK_TOOLS

if TYPE_CHECKING:
    from knotwork.runtime.knowledge_loader import KnowledgeTree

_MAX_TURNS = 20  # safety limit on tool-call iterations


def _extract_model(agent_ref: str) -> str:
    """'anthropic:claude-3-5-sonnet-20241022' → 'claude-3-5-sonnet-20241022'"""
    return agent_ref.removeprefix("anthropic:")


def _tool_result(tool_use_id: str, content: Any) -> dict:
    return {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": json.dumps(content) if not isinstance(content, str) else content,
    }


async def _build_prompts(
    run_state: dict,
    config: dict,
    knowledge_tree: "KnowledgeTree",
    outgoing_edges: list[dict],
    targets: list[str],
    trust: float,
    retry_guidance: str | None,
) -> tuple[str, str]:
    from knotwork.runtime.nodes.agent import _build_tail_blocks, _build_retry_user_prompt
    from knotwork.runtime.prompt_builder import build_agent_prompt

    if retry_guidance:
        return "", _build_retry_user_prompt(retry_guidance, outgoing_edges, targets)

    all_outputs: dict = run_state.get("node_outputs") or {}
    is_first_node = not all_outputs
    run_fields = run_state.get("input", {}) if is_first_node else {}
    context_files = run_state.get("context_files", []) if is_first_node else []
    project_id = run_state.get("project_id")
    async with AsyncSessionLocal() as db:
        project_context = await render_project_context(
            db,
            UUID(str(run_state["workspace_id"])),
            UUID(str(project_id)) if project_id else None,
        )

    system_p, user_p = build_agent_prompt(
        tree=knowledge_tree,
        state_fields=run_fields,
        context_files=context_files,
        project_context=project_context,
        prior_outputs=None,
    )
    extra = config.get("system_prompt") or config.get("instructions", "")
    if extra:
        system_p = f"{system_p}\n\n{extra}"

    system_p += (
        f"\n\n=== AUTONOMY LEVEL ===\n"
        f"Trust: {trust:.1f} — "
        f"0.0 means always ask the human before deciding; "
        f"1.0 means act fully autonomously."
    )
    user_p = f"{user_p}\n\n{_build_tail_blocks(outgoing_edges, targets)}"
    return system_p, user_p


class ClaudeAdapter(AgentAdapter):
    """Executes a node by running Claude with the four Knotwork-native tools."""

    def __init__(self, api_key: str | None = None) -> None:
        # Prefer the per-workspace key; fall back to the env-var default
        self._api_key = api_key

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
        from anthropic import AsyncAnthropic

        from knotwork.config import settings

        config = node_def.get("config", {})
        agent_ref: str = node_def.get("agent_ref", f"anthropic:{settings.default_model}")
        model = _extract_model(agent_ref)

        system_prompt, user_prompt = await _build_prompts(
            run_state, config, knowledge_tree,
            outgoing_edges=outgoing_edges or [],
            targets=targets or [],
            trust=trust,
            retry_guidance=retry_guidance,
        )
        effective_key = self._api_key or settings.anthropic_api_key or None
        client = AsyncAnthropic(api_key=effective_key)
        messages: list[dict] = [{"role": "user", "content": user_prompt}]

        yield NodeEvent("started", {"model": model, "system_prompt": system_prompt, "user_prompt": user_prompt})

        for _ in range(_MAX_TURNS):
            response = await client.messages.create(
                model=model,
                max_tokens=4096,
                system=system_prompt,
                tools=KNOTWORK_TOOLS,  # type: ignore[arg-type]
                messages=messages,  # type: ignore[arg-type]
            )
            messages.append({"role": "assistant", "content": response.content})

            tool_results: list[dict] = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                tool_name: str = block.name
                inp: dict = block.input  # type: ignore[attr-defined]
                tid: str = block.id

                if tool_name == "write_worklog":
                    yield NodeEvent("log_entry", {
                        "entry_type": "tool_call",
                        "content": "tool:write_worklog",
                        "metadata": {
                            "tool": "write_worklog",
                            "input": inp,
                            "output": {"ok": True},
                        },
                    })
                    yield NodeEvent("log_entry", {
                        "content": inp.get("content", ""),
                        "entry_type": inp.get("entry_type", "observation"),
                        "metadata": inp.get("metadata", {}),
                    })
                    tool_results.append(_tool_result(tid, {"ok": True}))

                elif tool_name == "propose_handbook_update":
                    yield NodeEvent("log_entry", {
                        "entry_type": "tool_call",
                        "content": "tool:propose_handbook_update",
                        "metadata": {
                            "tool": "propose_handbook_update",
                            "input": inp,
                            "output": {"ok": True, "status": "pending_review"},
                        },
                    })
                    yield NodeEvent("proposal", {
                        "path": inp.get("path", ""),
                        "proposed_content": inp.get("proposed_content", ""),
                        "reason": inp.get("reason", ""),
                    })
                    tool_results.append(_tool_result(tid, {"ok": True, "status": "pending_review"}))

                elif tool_name == "escalate":
                    yield NodeEvent("log_entry", {
                        "entry_type": "tool_call",
                        "content": "tool:escalate",
                        "metadata": {
                            "tool": "escalate",
                            "input": inp,
                            "output": {
                                "question": inp.get("question", ""),
                                "options": inp.get("options", []),
                            },
                        },
                    })
                    yield NodeEvent("escalation", {
                        "question": inp.get("question", ""),
                        "options": inp.get("options", []),
                    })
                    return  # run pauses; escalation event triggers interrupt

                elif tool_name == "complete_node":
                    completed_payload = {
                        "output": inp.get("output", ""),
                        "next_branch": inp.get("next_branch"),
                    }
                    yield NodeEvent("log_entry", {
                        "entry_type": "tool_call",
                        "content": "tool:complete_node",
                        "metadata": {
                            "tool": "complete_node",
                            "input": inp,
                            "output": completed_payload,
                        },
                    })
                    yield NodeEvent("completed", {
                        "output": completed_payload["output"],
                        "next_branch": completed_payload["next_branch"],
                    })
                    return

                else:
                    unsupported = {"ok": False, "error": f"unsupported tool: {tool_name}"}
                    yield NodeEvent("log_entry", {
                        "entry_type": "tool_call",
                        "content": f"tool:{tool_name} (unsupported)",
                        "metadata": {
                            "tool": tool_name,
                            "input": inp,
                            "output": unsupported,
                        },
                    })
                    tool_results.append(_tool_result(tid, unsupported))

            if not tool_results:
                # No tool calls — treat accumulated text as output
                texts = [b.text for b in response.content if hasattr(b, "text")]  # type: ignore[attr-defined]
                output_text = "\n".join(texts).strip() or "(no output)"
                yield NodeEvent("completed", {"output": output_text, "next_branch": None})
                return

            messages.append({"role": "user", "content": tool_results})

        yield NodeEvent("failed", {"error": f"exceeded {_MAX_TURNS} tool-call turns"})

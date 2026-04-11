"""
OpenAI adapter — uses the Assistants API (openai >= 1.0).

Creates a fresh Assistant + Thread per node execution (stateless for Phase 1).
Polls the run until completion or requires_action (tool calls).
Uses Knotwork-native tools.
"""
from __future__ import annotations

import json
from typing import TYPE_CHECKING, AsyncGenerator
from uuid import UUID

from core.api import projects as core_projects
from libs.database import AsyncSessionLocal
from .base import AgentAdapter, NodeEvent
from .tools import KNOTWORK_TOOLS

if TYPE_CHECKING:
    from ..knowledge_loader import KnowledgeTree

_MAX_POLL = 60  # maximum polling iterations (~60s at 1s intervals)

# Convert Knotwork tool defs to OpenAI function schema format
_OAI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": t["name"],
            "description": t["description"],
            "parameters": t["input_schema"],
        },
    }
    for t in KNOTWORK_TOOLS
]


def _extract_model(agent_ref: str) -> str:
    """'openai:gpt-4o' → 'gpt-4o'"""
    return agent_ref.removeprefix("openai:")


class OpenAIAdapter(AgentAdapter):
    """Executes a node via the OpenAI Assistants API."""

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
        import asyncio

        from openai import AsyncOpenAI

        from libs.config import settings
        from ..nodes.agent import _build_tail_blocks, _build_retry_user_prompt
        from ..prompt_builder import build_agent_prompt

        config = node_def.get("config", {})
        agent_ref: str = node_def.get("agent_ref", f"openai:{settings.default_model}")
        model = _extract_model(agent_ref)
        _edges = outgoing_edges or []
        _targets = targets or []

        # Build prompts — adapter owns the full prompt construction.
        if retry_guidance:
            system_prompt = ""
            user_prompt = _build_retry_user_prompt(retry_guidance, _edges, _targets)
        else:
            all_outputs: dict = run_state.get("node_outputs") or {}
            is_first_node = not all_outputs
            run_fields = run_state.get("input", {}) if is_first_node else {}
            context_files = run_state.get("context_files", []) if is_first_node else []
            project_id = run_state.get("project_id")
            async with AsyncSessionLocal() as db:
                project_context = await core_projects.render_project_context(
                    db,
                    UUID(str(run_state["workspace_id"])),
                    UUID(str(project_id)) if project_id else None,
                )

            system_prompt, user_prompt = build_agent_prompt(
                tree=knowledge_tree,
                state_fields=run_fields,
                context_files=context_files,
                project_context=project_context,
                prior_outputs=None,
            )
            extra = config.get("system_prompt") or config.get("instructions", "")
            if extra:
                system_prompt = f"{system_prompt}\n\n{extra}"

            system_prompt += (
                f"\n\n=== AUTONOMY LEVEL ===\n"
                f"Trust: {trust:.1f} — "
                f"0.0 means always ask the human before deciding; "
                f"1.0 means act fully autonomously."
            )
            user_prompt = f"{user_prompt}\n\n{_build_tail_blocks(_edges, _targets)}"

        effective_key = self._api_key or settings.openai_api_key or None
        client = AsyncOpenAI(api_key=effective_key)
        yield NodeEvent("started", {"model": model, "system_prompt": system_prompt, "user_prompt": user_prompt})

        # Create assistant + thread
        assistant = await client.beta.assistants.create(
            model=model,
            instructions=system_prompt,
            tools=_OAI_TOOLS,  # type: ignore[arg-type]
        )
        thread = await client.beta.threads.create()
        await client.beta.threads.messages.create(
            thread_id=thread.id,
            role="user",
            content=user_prompt,
        )

        # Start the run
        oai_run = await client.beta.threads.runs.create(
            thread_id=thread.id,
            assistant_id=assistant.id,
        )
        yield NodeEvent("provider_started", {
            "provider": "openai",
            "assistant_id": assistant.id,
            "thread_id": thread.id,
            "openai_run_id": oai_run.id,
            "request": {
                "model": model,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "tools": [t["function"]["name"] for t in _OAI_TOOLS],
            },
        })

        # Poll loop
        for _ in range(_MAX_POLL):
            await asyncio.sleep(1)
            oai_run = await client.beta.threads.runs.retrieve(
                thread_id=thread.id,
                run_id=oai_run.id,
            )

            if oai_run.status == "requires_action":
                tool_outputs = []
                stop = False
                for tc in oai_run.required_action.submit_tool_outputs.tool_calls:
                    name = tc.function.name
                    inp = json.loads(tc.function.arguments)

                    if name == "write_worklog":
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
                        tool_outputs.append({"tool_call_id": tc.id, "output": '{"ok":true}'})

                    elif name == "propose_handbook_update":
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
                        tool_outputs.append({"tool_call_id": tc.id, "output": '{"ok":true}'})

                    elif name == "escalate":
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
                        yield NodeEvent("provider_finished", {
                            "provider": "openai",
                            "assistant_id": assistant.id,
                            "thread_id": thread.id,
                            "openai_run_id": oai_run.id,
                            "status": "escalated",
                            "response": {
                                "tool": "escalate",
                                "question": inp.get("question", ""),
                                "options": inp.get("options", []),
                            },
                        })
                        yield NodeEvent("escalation", {
                            "question": inp.get("question", ""),
                            "options": inp.get("options", []),
                        })
                        await client.beta.threads.runs.cancel(thread_id=thread.id, run_id=oai_run.id)
                        await client.beta.assistants.delete(assistant.id)
                        return

                    elif name == "complete_node":
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
                        yield NodeEvent("provider_finished", {
                            "provider": "openai",
                            "assistant_id": assistant.id,
                            "thread_id": thread.id,
                            "openai_run_id": oai_run.id,
                            "status": "completed_via_tool",
                            "response": completed_payload,
                        })
                        yield NodeEvent("completed", {
                            "output": completed_payload["output"],
                            "next_branch": completed_payload["next_branch"],
                        })
                        stop = True
                        tool_outputs.append({"tool_call_id": tc.id, "output": '{"ok":true}'})

                    else:
                        # Never leave a required tool call without output:
                        # OpenAI run submission fails if any call_id is missing.
                        unsupported = {
                            "ok": False,
                            "error": f"unsupported tool: {name}",
                        }
                        yield NodeEvent("log_entry", {
                            "entry_type": "tool_call",
                            "content": f"tool:{name} (unsupported)",
                            "metadata": {
                                "tool": name,
                                "input": inp,
                                "output": unsupported,
                            },
                        })
                        tool_outputs.append({
                            "tool_call_id": tc.id,
                            "output": json.dumps(unsupported),
                        })

                if stop:
                    await client.beta.assistants.delete(assistant.id)
                    return
                await client.beta.threads.runs.submit_tool_outputs(
                    thread_id=thread.id, run_id=oai_run.id, tool_outputs=tool_outputs
                )

            elif oai_run.status == "completed":
                msgs = await client.beta.threads.messages.list(thread_id=thread.id)
                texts = [
                    block.text.value
                    for m in msgs.data if m.role == "assistant"
                    for block in m.content if block.type == "text"
                ]
                output_text = "\n".join(texts).strip() or "(no output)"
                yield NodeEvent("provider_finished", {
                    "provider": "openai",
                    "assistant_id": assistant.id,
                    "thread_id": thread.id,
                    "openai_run_id": oai_run.id,
                    "status": "completed",
                    "response": {"output_text": output_text},
                })
                yield NodeEvent("completed", {"output": output_text, "next_branch": None})
                await client.beta.assistants.delete(assistant.id)
                return

            elif oai_run.status in ("failed", "cancelled", "expired"):
                err = getattr(oai_run, "last_error", None)
                yield NodeEvent("provider_finished", {
                    "provider": "openai",
                    "assistant_id": assistant.id,
                    "thread_id": thread.id,
                    "openai_run_id": oai_run.id,
                    "status": oai_run.status,
                    "response": {"error": str(err) if err else oai_run.status},
                })
                yield NodeEvent("failed", {"error": str(err) if err else oai_run.status})
                await client.beta.assistants.delete(assistant.id)
                return

        await client.beta.assistants.delete(assistant.id)
        yield NodeEvent("provider_finished", {
            "provider": "openai",
            "assistant_id": assistant.id,
            "thread_id": thread.id,
            "openai_run_id": oai_run.id,
            "status": "polling_timeout",
            "response": {"error": "polling timeout"},
        })
        yield NodeEvent("failed", {"error": "polling timeout"})

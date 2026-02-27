"""
Designer agent: LLM assistant that produces graph_delta objects.

Conversation history is tracked per session_id (in-memory, see session.py).
Output is always JSON: {reply, graph_delta, questions}.
"""
from __future__ import annotations

import json
import re

from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.designer import session as sess

_SYSTEM = """\
You are a graph designer assistant for Knotwork, a business process automation platform.
Help the user build agent workflow graphs by modifying the graph definition via incremental deltas.

## Node types
- llm_agent: LLM reasoning node. Config: model, system_prompt, knowledge_paths (list), \
confidence_threshold (0.0-1.0), fail_safe (escalate|retry|stop), \
confidence_rules [{condition, set}], checkpoints [{type, expression}], tools (list)
- human_checkpoint: Human review gate. Config: prompt, timeout_hours
- conditional_router: Branch on conditions. Config: routing_rules [{condition, target}], default_target
- tool_executor: Run a tool. Config: tool_id, tool_config (dict)

## graph_delta schema
{
  "add_nodes": [{"id": "slug", "type": "...", "name": "...", "config": {}}],
  "update_nodes": [{"id": "...", "name": "...", "config": {...}}],
  "remove_nodes": ["node_id"],
  "add_edges": [{"id": "e-source-target", "source": "...", "target": "...", "type": "direct"}],
  "remove_edges": ["edge_id"],
  "set_entry_point": "node_id"
}

## Output — JSON only, no markdown fences:
{"reply": "...", "graph_delta": {...}, "questions": []}

Rules:
- Node ids must be kebab-case slugs of the name.
- Omit delta keys that have no changes.
- questions is empty when the request is unambiguous.
- Return an empty graph_delta ({}) when you are only asking questions.
"""

_FALLBACK = {
    "reply": "I couldn't parse the response. Please try rephrasing.",
    "graph_delta": {},
    "questions": [],
}


async def design_graph(
    session_id: str,
    message: str,
    workspace_id: str,
    existing_graph: dict | None,
    db: AsyncSession,
) -> dict:
    """
    Process a designer chat message and return graph modifications.

    Returns {reply, graph_delta, questions}.
    """
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

    graph_json = json.dumps(existing_graph or {}, indent=2)
    system_content = _SYSTEM + f"\n\nCurrent graph:\n{graph_json}"

    history = sess.get_history(session_id)
    messages = [SystemMessage(content=system_content)]
    for m in history:
        cls = HumanMessage if m["role"] == "user" else AIMessage
        messages.append(cls(content=m["content"]))
    messages.append(HumanMessage(content=message))

    try:
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
        response = await llm.ainvoke(messages)
        raw = response.content.strip()

        # Strip optional markdown code fences
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-z]*\n?", "", raw)
            raw = raw.rstrip("`").strip()

        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError("not a dict")
        result.setdefault("reply", "")
        result.setdefault("graph_delta", {})
        result.setdefault("questions", [])

    except Exception:
        result = _FALLBACK.copy()

    # Persist turn in session history
    sess.add_message(session_id, "user", message)
    sess.add_message(session_id, "assistant", result["reply"])

    return result



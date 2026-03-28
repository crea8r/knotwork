"""
Designer agent: LLM assistant that produces graph_delta objects.

Conversation history is persisted in the canonical workflow channel for the graph.
Output is always JSON: {reply, graph_delta, questions}.
"""
from __future__ import annotations

import json
import logging
import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_SYSTEM = """\
You are a graph designer assistant for Knotwork, a business process automation platform.
Help the user build agent workflow graphs by modifying the graph definition via incremental deltas.

## Node types
- start: Entry node. id MUST be "start". Connect to one or more nodes for parallel starts. \
No config needed.
- end: Terminal node. id MUST be "end". All terminal paths must connect here. No config needed.
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
  "set_entry_point": "node_id",
  "set_input_schema": [{"name": "field_key", "label": "Display Label", "description": "...", "required": true, "type": "text|textarea|number"}]
}

## Output — JSON only, no markdown fences:
{"reply": "...", "graph_delta": {...}, "questions": []}

Rules:
- Node ids must be kebab-case slugs of the name. start/end always use literal id "start"/"end".
- ALWAYS include "start" and "end" nodes in every graph — new or existing.
  If the current graph has no "start" or "end" node, add them and wire them appropriately.
- Omit delta keys that have no changes.
- questions is empty when the request is unambiguous.
- Return an empty graph_delta ({}) when you are only asking questions.
- ALWAYS ask before adding a conditional_router: you need at minimum the branch conditions \
and their target nodes. Do not add a router with empty routing_rules.
- ALWAYS ask before adding a tool_executor: you need the tool_id.
- For llm_agent and human_checkpoint you may add with sensible defaults and note what \
still needs configuring.
- ALWAYS include set_input_schema when creating or significantly modifying a graph. \
Define the case data the entry node needs (e.g. customer_email, contract_text). \
Use type "textarea" for long text (>1 paragraph), "text" for short values, "number" for numeric inputs.
"""

_HISTORY_LIMIT = 50

_FALLBACK = {
    "reply": "I couldn't parse the response. Please try rephrasing.",
    "graph_delta": {},
    "questions": [],
}


async def _load_history(graph_id: UUID, db: AsyncSession) -> list[dict]:
    from knotwork.channels.models import Channel, ChannelMessage
    channel_id = (
        await db.execute(
            select(Channel.id).where(
                Channel.graph_id == graph_id,
                Channel.channel_type == "workflow",
                Channel.archived_at.is_(None),
            ).limit(1)
        )
    ).scalar_one_or_none()
    if channel_id is None:
        return []
    result = await db.execute(
        select(ChannelMessage)
        .where(ChannelMessage.channel_id == channel_id)
        .order_by(ChannelMessage.created_at.asc())
        .limit(_HISTORY_LIMIT)
    )
    return [{"role": m.role, "content": m.content} for m in result.scalars()]


async def _save_messages(graph_id: UUID, db: AsyncSession, user_msg: str, assistant_msg: str) -> None:
    from knotwork.channels.models import Channel
    from knotwork.channels.schemas import ChannelMessageCreate
    from knotwork.channels.service import create_message
    from knotwork.graphs.models import Graph

    graph = await db.get(Graph, graph_id)
    if graph is None:
        return
    channel = (
        await db.execute(
            select(Channel).where(
                Channel.graph_id == graph_id,
                Channel.channel_type == "workflow",
                Channel.archived_at.is_(None),
            ).limit(1)
        )
    ).scalar_one_or_none()
    if channel is None:
        channel = Channel(
            workspace_id=graph.workspace_id,
            name=f"wf: {graph.name}",
            channel_type="workflow",
            graph_id=graph.id,
            project_id=graph.project_id,
        )
        db.add(channel)
        await db.commit()
        await db.refresh(channel)

    await create_message(
        db,
        workspace_id=graph.workspace_id,
        channel_id=channel.id,
        data=ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name="You",
            content=user_msg,
        ),
    )
    await create_message(
        db,
        workspace_id=graph.workspace_id,
        channel_id=channel.id,
        data=ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            author_name="Knotwork Agent",
            content=assistant_msg,
        ),
    )


def _normalize_result(result: dict | None) -> dict:
    if not isinstance(result, dict):
        return _FALLBACK.copy()

    reply = result.get("reply")
    graph_delta = result.get("graph_delta")
    questions = result.get("questions")

    return {
        "reply": reply if isinstance(reply, str) else "",
        "graph_delta": graph_delta if isinstance(graph_delta, dict) else {},
        "questions": [str(q) for q in questions] if isinstance(questions, list) else [],
    }


async def design_graph(
    session_id: str,
    message: str,
    workspace_id: str,
    existing_graph: dict | None,
    db: AsyncSession,
    graph_id: str | None = None,
) -> dict:
    """
    Process a designer chat message and return graph modifications.

    Returns {reply, graph_delta, questions}.
    graph_id is used to load/save DB history. Falls back to in-memory if None.
    """
    graph_json = json.dumps(existing_graph or {}, indent=2)
    system_content = _SYSTEM + f"\n\nCurrent graph:\n{graph_json}"

    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
        from knotwork.config import settings

        # Load history from DB if graph_id is provided, else use no history.
        # Any failure here should degrade to a safe assistant reply, not a 500.
        if graph_id:
            history = await _load_history(UUID(graph_id), db)
        else:
            history = []

        messages = [SystemMessage(content=system_content)]
        for m in history:
            cls = HumanMessage if m["role"] == "user" else AIMessage
            messages.append(cls(content=m["content"]))
        messages.append(HumanMessage(content=message))

        llm = ChatOpenAI(
            model="gpt-4o-mini",
            temperature=0,
            api_key=settings.openai_api_key,
            model_kwargs={"response_format": {"type": "json_object"}},
        )
        response = await llm.ainvoke(messages)
        raw = response.content.strip()
        # Strip optional ```json ... ``` fences
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw).strip()
        logger.debug("LLM raw response: %s", raw)
        result = _normalize_result(json.loads(raw))

    except Exception as exc:
        logger.error("design_graph failed: %s", exc, exc_info=True)
        result = _FALLBACK.copy()

    # Persist turn in DB history, but never fail the request because of it.
    if graph_id:
        try:
            await _save_messages(UUID(graph_id), db, message, result["reply"])
        except Exception as exc:
            logger.error("designer history persistence failed: %s", exc, exc_info=True)
            await db.rollback()

    return result

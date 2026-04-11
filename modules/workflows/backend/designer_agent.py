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

from core.api import channels as core_channels

logger = logging.getLogger(__name__)

_SYSTEM = """\
You are AgentZero, the graph designer assistant for Knotwork, a business process automation platform.
Help the user build agent workflow graphs by modifying the graph definition via incremental deltas.

## Node types
- start: Entry node. id MUST be "start". Connect to one or more nodes for parallel starts. \
No config needed.
- end: Terminal node. id MUST be "end". All terminal paths must connect here. No config needed.
- agent: Unified work node. Top-level fields: agent_ref, trust_level, registered_agent_id. \
Config: system_prompt (or question for human nodes), knowledge_paths (list), model (optional).

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
- Use multi-branch edges from an `agent` node instead of separate router nodes. \
When adding branching, make sure every outgoing edge has a condition_label.
- Use `agent_ref: "human"` when the step is human-supervised or manually performed.
- ALWAYS include set_input_schema when creating or significantly modifying a graph. \
Define the case data the entry node needs (e.g. customer_email, contract_text). \
Use type "textarea" for long text (>1 paragraph), "text" for short values, "number" for numeric inputs.
"""

_HISTORY_LIMIT = 50

_FALLBACK = {
    "reply": "I couldn't parse the response. Please try rephrasing.",
    "graph_delta": {},
    "questions": [],
    "author_name": "AgentZero",
}


def _chat_openai_model_name(model_ref: str | None) -> str:
    if not model_ref:
        return "gpt-4o"
    normalized = str(model_ref).strip()
    if not normalized:
        return "gpt-4o"
    if "/" in normalized:
        provider, model = normalized.split("/", 1)
        if provider == "openai" and model:
            return model
    return normalized if normalized.startswith("gpt-") else "gpt-4o"


async def _agentzero_identity(workspace_id: UUID, db: AsyncSession) -> tuple[str, str | None]:
    from libs.auth.backend.models import User
    from modules.admin.backend.workspaces_models import Workspace, WorkspaceMember

    row = (
        await db.execute(
            select(User.name, Workspace.default_model)
            .select_from(WorkspaceMember)
            .join(User, User.id == WorkspaceMember.user_id)
            .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.agent_zero_role.is_(True),
                WorkspaceMember.access_disabled_at.is_(None),
            )
            .limit(1)
        )
    ).first()
    if row is not None:
        return (str(row[0] or "AgentZero"), _chat_openai_model_name(str(row[1]) if row[1] else None))

    workspace_default_model = (
        await db.execute(
            select(Workspace.default_model).where(Workspace.id == workspace_id).limit(1)
        )
    ).scalar_one_or_none()
    return ("AgentZero", _chat_openai_model_name(str(workspace_default_model) if workspace_default_model else None))


async def _load_history(graph_id: UUID, db: AsyncSession) -> list[dict]:
    from modules.communication.backend.channels_models import Channel, ChannelMessage
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


async def _save_messages(
    graph_id: UUID,
    db: AsyncSession,
    user_msg: str,
    assistant_msg: str,
    assistant_name: str,
    requester_participant_id: str | None = None,
    assistant_participant_id: str | None = None,
) -> None:
    from modules.communication.backend.channels_models import Channel, ChannelSubscription
    from modules.communication.backend.channels_schemas import ChannelMessageCreate
    from modules.workflows.backend.graphs_models import Graph

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
        await db.flush()

    participant_ids = [
        participant_id
        for participant_id in [requester_participant_id, assistant_participant_id]
        if participant_id
    ]
    if len(participant_ids) >= 2:
        rows = await db.execute(
            select(ChannelSubscription).where(
                ChannelSubscription.workspace_id == graph.workspace_id,
                ChannelSubscription.channel_id == channel.id,
                ChannelSubscription.participant_id.in_(participant_ids),
            )
        )
        existing = {row.participant_id: row for row in rows.scalars()}
        for participant_id in participant_ids:
            subscription = existing.get(participant_id)
            if subscription is None:
                db.add(
                    ChannelSubscription(
                        workspace_id=graph.workspace_id,
                        channel_id=channel.id,
                        participant_id=participant_id,
                    )
                )
            elif subscription.unsubscribed_at is not None:
                subscription.unsubscribed_at = None
        await db.flush()

    await core_channels.create_message(
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
    await core_channels.create_message(
        db,
        workspace_id=graph.workspace_id,
        channel_id=channel.id,
        data=ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            author_name=assistant_name,
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
        "author_name": str(result.get("author_name") or "AgentZero"),
    }


async def design_graph(
    session_id: str,
    message: str,
    workspace_id: str,
    existing_graph: dict | None,
    db: AsyncSession,
    graph_id: str | None = None,
    requester_participant_id: str | None = None,
) -> dict:
    """
    Process a designer chat message and return graph modifications.

    Returns {reply, graph_delta, questions, author_name}.
    graph_id is used to load/save DB history. Falls back to in-memory if None.
    """
    graph_json = json.dumps(existing_graph or {}, indent=2)
    system_content = _SYSTEM + f"\n\nCurrent graph:\n{graph_json}"
    workspace_uuid = UUID(workspace_id)
    assistant_name, assistant_model = await _agentzero_identity(workspace_uuid, db)
    result = {
        **_FALLBACK,
        "author_name": assistant_name,
    }
    assistant_participant_id = None

    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
        from libs.auth.backend.models import User
        from libs.config import settings
        from modules.admin.backend.workspaces_models import WorkspaceMember

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

        agentzero = (
            await db.execute(
                select(WorkspaceMember.id, User.id)
                .join(User, User.id == WorkspaceMember.user_id)
                .where(
                    WorkspaceMember.workspace_id == workspace_uuid,
                    WorkspaceMember.agent_zero_role.is_(True),
                    WorkspaceMember.access_disabled_at.is_(None),
                )
                .limit(1)
            )
        ).first()
        if agentzero is not None:
            assistant_participant_id = f"agent:{agentzero[0]}"

        llm = ChatOpenAI(
            model=assistant_model or "gpt-4o",
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
        result["author_name"] = assistant_name

    except Exception as exc:
        logger.error("design_graph failed: %s", exc, exc_info=True)
        result = {
            **_FALLBACK,
            "author_name": assistant_name,
        }

    # Persist turn in DB history, but never fail the request because of it.
    if graph_id:
        try:
            await _save_messages(
                UUID(graph_id),
                db,
                message,
                result["reply"],
                assistant_name=result["author_name"],
                requester_participant_id=requester_participant_id,
                assistant_participant_id=assistant_participant_id,
            )
        except Exception as exc:
            logger.error("designer history persistence failed: %s", exc, exc_info=True)
            await db.rollback()

    return result

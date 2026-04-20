from __future__ import annotations

import re
from typing import Any

from core.mcp.contracts.schemas import MCPContract
from core.mcp.contracts.work_packet_builder import base_work_packet, trim_packet_context
from core.mcp.contracts.work_packet_context import (
    LoadedWorkPacketContext,
    first_non_empty,
    isoformat_or_none,
    serialize_message,
    serialize_participant,
    trigger_asset_type,
    trigger_run_id,
)


def _mention_tokens(value: str | None) -> list[str]:
    return [match.group(1).lower() for match in re.finditer(r"(?<!\w)@([A-Za-z0-9._-]+)", value or "")]


def _participant_aliases(participant: dict[str, Any]) -> set[str]:
    aliases: set[str] = set()

    def add(value: str | None) -> None:
        normalized = re.sub(r"[^a-z0-9._-]+", "", (value or "").lower())
        if normalized:
            aliases.add(normalized)

    add(participant.get("mention_handle"))
    add(participant.get("display_name"))
    for part in str(participant.get("display_name") or "").split():
        add(part)
    email = participant.get("email")
    if isinstance(email, str) and email:
        add(email.split("@", 1)[0])
    return aliases


def _metadata_participant_ids(metadata: dict[str, Any] | None) -> list[str]:
    raw = (metadata or {}).get("mentioned_participant_ids")
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if str(item)]


def _message_mention_participant_ids(
    message_metadata: dict[str, Any] | None,
    message_content: str | None,
    participants: list[dict[str, Any]],
) -> list[str]:
    from_metadata = _metadata_participant_ids(message_metadata)
    if from_metadata:
        return from_metadata
    tokens = set(_mention_tokens(message_content))
    if not tokens:
        return []
    matched: list[str] = []
    for participant in participants:
        if any(alias in tokens for alias in _participant_aliases(participant)):
            matched.append(str(participant["participant_id"]))
    return matched


def _authored_by_self(message, self_participant_id: str, self_name: str) -> bool:
    author_participant_id = (message.metadata_ or {}).get("author_participant_id")
    if isinstance(author_participant_id, str) and author_participant_id == self_participant_id:
        return True
    return bool(message.author_name and message.author_name == self_name and message.author_type == "agent")


def _was_recently_involved(
    *,
    context: LoadedWorkPacketContext,
) -> bool:
    if not context.self_participant_id or context.trigger_message is None:
        return False
    trigger_index = next(
        (index for index, item in enumerate(context.channel_messages) if item.id == context.trigger_message.id),
        len(context.channel_messages),
    )
    prior_messages = context.channel_messages[max(0, trigger_index - 8):trigger_index]
    return any(
        _authored_by_self(message, context.self_participant_id, context.current_user.name)
        or context.self_participant_id in _metadata_participant_ids(message.metadata_ if isinstance(message.metadata_, dict) else None)
        for message in prior_messages
    )


def _is_two_member_direct_channel(context: LoadedWorkPacketContext) -> bool:
    if not context.self_participant_id:
        return False
    active_participants = [
        participant for participant in context.participants if participant.get("subscribed", True) is not False
    ]
    return len(active_participants) == 2 and any(
        str(participant["participant_id"]) == context.self_participant_id for participant in active_participants
    )


def _request_metadata(context: LoadedWorkPacketContext) -> dict[str, Any] | None:
    if context.trigger_message is None:
        return None
    metadata = context.trigger_message.metadata_ or {}
    if not isinstance(metadata, dict):
        return None
    request = metadata.get("request")
    if not isinstance(request, dict):
        return None
    if str(metadata.get("kind") or "") != "request":
        return None
    if isinstance(metadata.get("flow"), dict):
        request = dict(request)
        request["flow"] = metadata["flow"]
    return request


def workflow_resolution_context(context: LoadedWorkPacketContext) -> dict[str, Any]:
    request = _request_metadata(context)
    return {
        "trigger_type": str(context.trigger.get("type") or ""),
        "channel_type": str(context.channel.channel_type) if context.channel is not None else "",
        "request": request,
        "run_present": context.run is not None,
        "escalation_present": context.escalation is not None,
        "asset_type": (
            str(context.primary_asset.get("asset_type"))
            if context.primary_asset is not None
            else first_non_empty(trigger_asset_type(context.trigger))
        ),
        "graph_present": context.graph is not None,
        "is_telemetry_trigger": _is_telemetry_message(context),
    }


def _request_questions(request: dict[str, Any] | None) -> list[str]:
    if not isinstance(request, dict):
        return []
    raw = request.get("questions")
    if not isinstance(raw, list):
        return []
    return [text for item in raw if (text := str(item).strip())]


def _assigned_participant_ids(context: LoadedWorkPacketContext) -> list[str]:
    if context.trigger_message is None:
        return []
    metadata = context.trigger_message.metadata_ or {}
    if not isinstance(metadata, dict):
        return []
    values: list[str] = []
    top_level = metadata.get("assigned_to")
    if isinstance(top_level, list):
        values.extend(str(item).strip() for item in top_level if str(item).strip())
    request = metadata.get("request")
    if isinstance(request, dict):
        request_assigned = request.get("assigned_to")
        if isinstance(request_assigned, list):
            values.extend(str(item).strip() for item in request_assigned if str(item).strip())
    out: list[str] = []
    seen: set[str] = set()
    for participant_id in values:
        if participant_id in seen:
            continue
        seen.add(participant_id)
        out.append(participant_id)
    return out


def _is_telemetry_message(context: LoadedWorkPacketContext) -> bool:
    if context.trigger_message is None:
        return False
    metadata = context.trigger_message.metadata_ or {}
    if not isinstance(metadata, dict):
        return False
    return str(metadata.get("kind") or "").strip() in {
        "run_start",
        "agent_progress",
        "channel_run_started",
        "objective_run_started",
        "workflow_run_created",
    }


def _message_response_policy(context: LoadedWorkPacketContext) -> dict[str, Any] | None:
    request = _request_metadata(context)
    mentioned_participant_ids = _message_mention_participant_ids(
        context.trigger_message.metadata_ if context.trigger_message and isinstance(context.trigger_message.metadata_, dict) else None,
        context.trigger_message.content if context.trigger_message else None,
        context.participants,
    )
    assigned_participant_ids = _assigned_participant_ids(context)
    addressed_to_self = bool(context.self_participant_id and context.self_participant_id in assigned_participant_ids)
    is_telemetry_trigger = _is_telemetry_message(context)
    channel_type = str(context.channel.channel_type) if context.channel is not None else ""
    is_workflow_run_context = bool(
        context.run is not None
        or request is not None
        or str(trigger_run_id(context.trigger) or "").strip()
        or channel_type == "run"
    )
    directly_mentioned_self = bool(context.self_participant_id and context.self_participant_id in mentioned_participant_ids)
    mentioned_other_participant_ids = [pid for pid in mentioned_participant_ids if pid != context.self_participant_id]
    recently_involved = _was_recently_involved(context=context)
    trigger_message_id = str(context.trigger_message.id) if context.trigger_message else None

    if is_telemetry_trigger and context.trigger.get("type") == "message_posted" and is_workflow_run_context:
        decision = "must_noop"
        reason = "trigger message is telemetry and does not require an agent reply"
        directly_mentioned_self = False
        mentioned_other_participant_ids = []
    elif assigned_participant_ids and not addressed_to_self and is_workflow_run_context:
        decision = "must_noop"
        reason = "message is explicitly assigned to other participant(s)"
        directly_mentioned_self = False
    elif assigned_participant_ids and not addressed_to_self:
        decision = "model_decides"
        reason = "message is explicitly assigned to other participant(s); only intervene if needed"
        directly_mentioned_self = False
    elif request is not None and str(request.get("status") or "open") == "open":
        decision = "must_answer"
        reason = "channel has an open structured request message requiring a response"
        directly_mentioned_self = False
        mentioned_other_participant_ids = []
    elif assigned_participant_ids and addressed_to_self and context.trigger.get("type") == "message_posted":
        decision = "must_answer"
        reason = "message is explicitly assigned to this agent"
        directly_mentioned_self = False
    elif context.trigger.get("type") != "message_posted":
        return None
    elif directly_mentioned_self:
        decision = "must_answer"
        reason = "message_posted directly mentions this agent"
    elif mentioned_other_participant_ids and is_workflow_run_context:
        decision = "must_noop"
        reason = "message_posted mentions other participant(s), not this agent"
        directly_mentioned_self = False
    elif mentioned_other_participant_ids:
        decision = "model_decides"
        reason = "message_posted mentions other participant(s), not this agent; only intervene if needed"
        directly_mentioned_self = False
    elif _is_two_member_direct_channel(context):
        decision = "must_answer"
        reason = "message_posted is in a two-member channel, so the unmentioned message is directed at this agent"
    else:
        decision = "model_decides"
        reason = (
            "message_posted mentions nobody, but this agent was recently involved in the thread"
            if recently_involved
            else "message_posted mentions nobody; answer only if clearly in scope for this agent role/objective"
        )

    return {
        "decision": decision,
        "reason": reason,
        "trigger_message_id": trigger_message_id,
        "directly_mentioned_self": directly_mentioned_self,
        "mentioned_other_participant_ids": mentioned_other_participant_ids,
        "mentioned_participant_ids": mentioned_participant_ids,
        "assigned_participant_ids": assigned_participant_ids,
        "addressed_to_self": addressed_to_self,
        "recently_involved": recently_involved,
    }


def build_workflows_work_packet(
    *,
    context: LoadedWorkPacketContext,
    interaction: MCPContract,
) -> dict[str, Any]:
    request = _request_metadata(context)
    asset_type = (
        str(context.primary_asset.get("asset_type"))
        if context.primary_asset is not None
        else first_non_empty(trigger_asset_type(context.trigger))
    )
    context_hints = [
        {"kind": "query", "value": "channel.latest_messages"} if context.channel is not None else None,
        {"kind": "query", "value": "channel.participants"} if context.channel is not None else None,
        {"kind": "query", "value": "channel.assets"} if context.channel is not None else None,
        {"kind": "query", "value": "graph.current_draft"} if context.graph is not None else None,
        {"kind": "query", "value": "objective.chain"} if context.objective_chain else None,
        {"kind": "query", "value": "run.summary"} if context.run is not None else None,
        {"kind": "query", "value": "escalation.context"} if context.escalation is not None else None,
        {"kind": "query", "value": f"asset.{asset_type}"} if asset_type else None,
    ]
    packet = base_work_packet(
        context,
        interaction,
        context_hints=[item for item in context_hints if item is not None],
        message_response_policy=_message_response_policy(context),
    )

    if context.channel is not None:
        packet["channel_summary"] = {
            "id": str(context.channel.id),
            "name": context.channel.name,
            "slug": context.channel.slug,
            "channel_type": context.channel.channel_type,
            "participant_count": sum(
                1 for participant in context.participants if participant.get("subscribed", True) is not False
            ),
            "asset_count": len(context.assets),
        }
    if context.trigger_message is not None:
        packet["trigger_message"] = serialize_message(context.trigger_message)
    packet["recent_messages"] = [serialize_message(message) for message in context.channel_messages[-6:]]
    packet["participants"] = [
        serialize_participant(participant)
        for participant in context.participants[:8]
        if participant.get("subscribed", True) is not False
    ]
    packet["asset_summaries"] = [
        {
            "asset_type": row["asset_type"],
            "asset_id": row["asset_id"],
            "display_name": row["display_name"],
            "path": row["path"],
            "status": row["status"],
        }
        for row in context.assets[:8]
    ]
    packet["primary_subject"] = (
        {
            "kind": "workflow",
            "id": str(context.graph.id),
            "label": context.graph.name,
        }
        if interaction.session_type == "workflow.edit" and context.graph is not None
        else {
            "kind": "run",
            "id": str(context.run.id),
            "label": context.run.name or str(context.run.id),
        }
        if interaction.session_type == "workflow.run.followup" and context.run is not None
        else {
            "kind": str(context.primary_asset.get("asset_type")),
            "id": str(context.primary_asset.get("asset_id")),
            "label": str(
                context.primary_asset.get("display_name")
                or context.primary_asset.get("path")
                or context.primary_asset.get("asset_id")
            ),
            "path": context.primary_asset.get("path"),
        }
        if context.primary_asset is not None
        else None
    )
    packet["graph_summary"] = (
        {
            "id": str(context.graph.id),
            "name": context.graph.name,
            "path": context.graph.path,
            "status": context.graph.status,
            "default_model": context.graph.default_model,
            "has_root_draft": context.root_draft is not None,
        }
        if context.graph is not None
        else None
    )
    packet["run_summary"] = (
        {
            "id": str(context.run.id),
            "status": context.run.status,
            "trigger": context.run.trigger,
            "name": context.run.name,
            "created_at": isoformat_or_none(context.run.created_at),
        }
        if context.run is not None
        else None
    )
    packet["escalation_summary"] = (
        {
            "id": str(context.escalation.id),
            "type": context.escalation.type,
            "status": context.escalation.status,
        }
        if context.escalation is not None
        else None
    )
    packet["request_summary"] = (
        {
            "message_id": str(context.trigger_message.id),
            "type": str(request.get("type") or "request"),
            "status": str(request.get("status") or "open"),
            "questions": _request_questions(request),
            "assigned_to": request.get("assigned_to"),
            "response_schema": request.get("response_schema"),
            "flow": request.get("flow") if isinstance(request.get("flow"), dict) else None,
        }
        if request is not None and context.trigger_message is not None
        else None
    )
    packet["request_context"] = str(request.get("context_markdown") or "") if request is not None else None
    return trim_packet_context(packet, interaction.contract)

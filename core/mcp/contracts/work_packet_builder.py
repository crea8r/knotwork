from __future__ import annotations

from typing import Any

from .schemas import MCPContract
from .work_packet_context import (
    LoadedWorkPacketContext,
    trigger_channel_id,
    trigger_detail,
    trigger_escalation_id,
    trigger_message_id,
    trigger_proposal_id,
    trigger_run_id,
)


def _compact_dict(value: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, item in value.items():
        if item is None:
            continue
        if isinstance(item, dict):
            nested = _compact_dict(item)
            if nested:
                out[key] = nested
            continue
        if isinstance(item, list):
            compact_list = [entry for entry in item if entry is not None]
            if compact_list:
                out[key] = compact_list
            continue
        out[key] = item
    return out


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
    return request


def render_trigger(context: LoadedWorkPacketContext) -> dict[str, Any]:
    trigger = context.trigger
    trigger_type = str(trigger.get("type") or "")
    detail = trigger_detail(trigger)
    message_id = trigger_message_id(trigger)
    run_id = trigger_run_id(trigger)
    escalation_id = trigger_escalation_id(trigger)
    proposal_id = trigger_proposal_id(trigger)

    if trigger_type == "mentioned_message":
        metadata = context.trigger_message.metadata_ if context.trigger_message and isinstance(context.trigger_message.metadata_, dict) else {}
        mentioned_ids = metadata.get("mentioned_participant_ids") if isinstance(metadata, dict) else None
        detail = _compact_dict({
            "message_id": message_id,
            "mentioned_participant_ids": mentioned_ids if isinstance(mentioned_ids, list) else None,
        })
    elif trigger_type == "task_assigned":
        request = _request_metadata(context)
        detail = _compact_dict({
            "message_id": message_id,
            "run_id": run_id,
            "task": {
                "message_id": message_id,
                "run_id": run_id,
                "escalation_id": escalation_id or (request.get("escalation_id") if isinstance(request, dict) else None),
                "type": request.get("type") if isinstance(request, dict) else None,
                "status": request.get("status") if isinstance(request, dict) else None,
                "questions": request.get("questions") if isinstance(request, dict) else None,
                "assigned_to": request.get("assigned_to") if isinstance(request, dict) else None,
                "response_schema": request.get("response_schema") if isinstance(request, dict) else None,
            },
        })
    elif trigger_type == "message_posted":
        detail = _compact_dict({"message_id": message_id})
    elif trigger_type == "escalation":
        detail = _compact_dict({"escalation_id": escalation_id, "run_id": run_id})
    elif trigger_type == "run_event":
        detail = _compact_dict({"run_id": run_id})
    elif trigger_type == "knowledge_change":
        asset = context.primary_asset or {}
        detail = _compact_dict({
            "proposal_id": proposal_id,
            "run_id": run_id,
            "asset": {
                "type": asset.get("asset_type"),
                "id": asset.get("asset_id"),
                "path": asset.get("asset_path"),
            },
        })

    return _compact_dict({
        "type": trigger_type,
        "delivery_id": trigger.get("delivery_id"),
        "channel_id": trigger_channel_id(trigger),
        "title": trigger.get("title"),
        "subtitle": trigger.get("subtitle"),
        "detail": detail,
    })


def initial_context_sections(contract) -> set[str]:
    sections: set[str] = set()
    for action in getattr(contract, "actions", []) or []:
        if str(getattr(action, "kind", "") or "") != "read":
            continue
        if str(getattr(action, "visibility", "") or "") != "initial":
            continue
        section = str(getattr(action, "context_section", "") or "").strip()
        if section:
            sections.add(section)
    return sections


def trim_packet_context(packet: dict[str, Any], contract) -> dict[str, Any]:
    sections = initial_context_sections(contract)
    for key, empty_value in {
        "trigger_message": None,
        "recent_messages": [],
        "participants": [],
        "asset_summaries": [],
        "primary_subject": None,
        "objective_chain": [],
        "graph_summary": None,
        "run_summary": None,
        "escalation_summary": None,
        "request_summary": None,
        "request_context": None,
    }.items():
        if key not in sections:
            packet[key] = empty_value
    packet["context_hints"] = []
    return packet


def contract_ref(contract) -> dict[str, Any]:
    return {
        "id": contract.id,
        "checksum": contract.checksum,
        "title": contract.title,
        "owning_module": contract.owning_module,
        "allowed_actions": list(contract.allowed_actions),
        "context_sections": list(contract.context_sections),
        "instructions": list(contract.instructions),
    }


def default_work_policy() -> dict[str, Any]:
    return {
        "response_mode": "interactive",
        "prefer_small_next_action": True,
        "explore_before_large_changes": True,
        "instructions": [
            "Act through Knotwork actions only.",
            "Prefer the smallest useful next action over a full one-shot solution.",
            "Stay tightly scoped to the immediate notification and surface it refers to.",
            "If the trigger is ambiguous or lacks context, post a clarifying message instead of fabricating missing details.",
        ],
    }


def base_work_packet(
    context: LoadedWorkPacketContext,
    interaction: MCPContract,
    *,
    context_hints: list[dict[str, Any]] | None = None,
    message_response_policy: dict[str, Any] | None = None,
    work_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    channel = context.channel
    return {
        "version": "knotwork.mcp/v1",
        "task_id": context.task_id,
        "session_type": interaction.session_type,
        "trigger": render_trigger(context),
        "mcp_contract": contract_ref(interaction.contract),
        "task_focus": {
            "mode": interaction.session_type,
            "immediate_instruction": interaction.immediate_instruction,
            "preferred_actions": interaction.preferred_actions,
            "strict_scope": interaction.strict_scope,
            "mode_instructions": interaction.mode_instructions,
        },
        "workspace": {
            "id": str(context.workspace.id),
            "name": context.workspace.name,
        },
        "agent": {
            "member_id": str(context.member.id),
            "participant_id": context.self_participant_id,
            "name": context.current_user.name,
            "role": context.member.role,
            "kind": context.member.kind,
            "contribution_brief": context.member.contribution_brief,
            "availability_status": context.member.availability_status or "available",
            "capacity_level": context.member.capacity_level or "open",
        },
        "refs": {
            "channel_id": str(channel.id) if channel else None,
            "objective_id": str(channel.objective_id) if channel and channel.objective_id else None,
            "graph_id": str(channel.graph_id) if channel and channel.graph_id else None,
            "run_id": str(context.run.id) if context.run else trigger_run_id(context.trigger),
            "escalation_id": (
                str(context.escalation.id)
                if context.escalation
                else trigger_escalation_id(context.trigger)
            ),
            "proposal_id": trigger_proposal_id(context.trigger),
        },
        "continuation_key": {
            "kind": "channel" if channel is not None else "task",
            "id": str(channel.id) if channel is not None else (context.session_name or context.task_id),
        },
        "allowed_actions": list(dict.fromkeys(interaction.preferred_actions)),
        "work_policy": work_policy or default_work_policy(),
        "message_response_policy": message_response_policy,
        "channel_summary": None,
        "trigger_message": None,
        "recent_messages": [],
        "participants": [],
        "asset_summaries": [],
        "primary_subject": None,
        "objective_chain": context.objective_chain,
        "graph_summary": None,
        "run_summary": None,
        "escalation_summary": None,
        "request_summary": None,
        "request_context": None,
        "context_hints": context_hints or [],
        "legacy_task_context": context.legacy_user_prompt or None,
    }

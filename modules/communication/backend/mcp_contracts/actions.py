from __future__ import annotations

from core.mcp.contracts.schemas import MCPContractAction


def _object_schema(*, properties: dict, required: list[str] | None = None, additional_properties: bool = False) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": additional_properties,
    }


def _string_schema(*, enum: list[str] | None = None) -> dict:
    schema = {"type": "string"}
    if enum:
        schema["enum"] = enum
    return schema


def _array_schema(item_schema: dict) -> dict:
    return {"type": "array", "items": item_schema}


def _context_action(
    *,
    name: str,
    description: str,
    section: str,
    visibility: str,
    output_schema: dict,
) -> MCPContractAction:
    return MCPContractAction(
        name=name,
        description=description,
        kind="read",
        visibility=visibility,  # type: ignore[arg-type]
        context_section=section,
        target_schema=_object_schema(properties={}),
        payload_schema=_object_schema(properties={}),
        output_schema=output_schema,
    )


def _message_schema() -> dict:
    return _object_schema(
        properties={
            "id": _string_schema(),
            "created_at": _string_schema(),
            "role": _string_schema(),
            "author_type": _string_schema(),
            "author_name": _string_schema(),
            "content": _string_schema(),
            "metadata": {"type": "object", "additionalProperties": True},
        },
        required=["id", "role", "author_type", "content"],
    )


def _participant_schema() -> dict:
    return _object_schema(
        properties={
            "participant_id": _string_schema(),
            "display_name": _string_schema(),
            "kind": _string_schema(),
            "mention_handle": _string_schema(),
            "contribution_brief": _string_schema(),
            "availability_status": _string_schema(),
            "capacity_level": _string_schema(),
            "subscribed": {"type": "boolean"},
        },
        required=["participant_id", "kind", "availability_status", "capacity_level", "subscribed"],
    )


def _escalation_summary_schema() -> dict:
    return _object_schema(
        properties={"id": _string_schema(), "type": _string_schema(), "status": _string_schema()},
        required=["id", "type", "status"],
    )


COMMUNICATION_ACTION_NAMES = {
    "context.get_trigger_message",
    "context.get_recent_messages",
    "context.get_participants",
    "context.get_escalation_summary",
    "channel.post_message",
    "escalation.resolve",
    "control.noop",
    "control.fail",
}


def build_trigger_message_context_action(*, description: str, visibility: str = "initial") -> MCPContractAction:
    return _context_action(
        name="context.get_trigger_message",
        description=description,
        section="trigger_message",
        visibility=visibility,
        output_schema=_message_schema(),
    )


def build_recent_messages_context_action(*, description: str, visibility: str = "on_demand") -> MCPContractAction:
    return _context_action(
        name="context.get_recent_messages",
        description=description,
        section="recent_messages",
        visibility=visibility,
        output_schema={"type": "array", "items": _message_schema()},
    )


def build_participants_context_action(*, description: str, visibility: str = "on_demand") -> MCPContractAction:
    return _context_action(
        name="context.get_participants",
        description=description,
        section="participants",
        visibility=visibility,
        output_schema={"type": "array", "items": _participant_schema()},
    )


def build_escalation_summary_action(*, visibility: str = "initial") -> MCPContractAction:
    return _context_action(
        name="context.get_escalation_summary",
        description="Load the active escalation summary.",
        section="escalation_summary",
        visibility=visibility,
        output_schema=_escalation_summary_schema(),
    )


def build_channel_post_message_action(*, description: str) -> MCPContractAction:
    return MCPContractAction(
        name="channel.post_message",
        description=description,
        kind="write",
        target_schema=_object_schema(properties={"channel_id": _string_schema()}, required=["channel_id"]),
        payload_schema=_object_schema(
            properties={"content": _string_schema(), "author_name": _string_schema(), "run_id": _string_schema()},
            required=["content"],
        ),
    )


def build_escalation_resolve_action() -> MCPContractAction:
    return MCPContractAction(
        name="escalation.resolve",
        description="Resolve the active escalation.",
        kind="write",
        target_schema=_object_schema(properties={"escalation_id": _string_schema()}, required=["escalation_id"]),
        payload_schema=_object_schema(
            properties={
                "resolution": _string_schema(enum=["accept_output", "override_output", "request_revision", "abort_run"]),
                "guidance": _string_schema(),
                "override_output": {"type": "object", "additionalProperties": True},
                "next_branch": _string_schema(),
                "answers": _array_schema(_string_schema()),
                "channel_id": _string_schema(),
            },
            required=["resolution"],
        ),
    )


def build_control_noop_action(*, description: str = "Take no external action.") -> MCPContractAction:
    return MCPContractAction(
        name="control.noop",
        description=description,
        kind="control",
        target_schema=_object_schema(properties={}),
        payload_schema=_object_schema(properties={"reason": _string_schema()}, required=["reason"]),
    )


def build_control_fail_action(*, description: str) -> MCPContractAction:
    return MCPContractAction(
        name="control.fail",
        description=description,
        kind="control",
        target_schema=_object_schema(properties={}),
        payload_schema=_object_schema(properties={"reason": _string_schema()}, required=["reason"]),
    )

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import channels as core_channels
from core.mcp.contracts.schemas import MCPActionResult, MCPContract, MCPContractAction, MCPContractExample, MCPContractManifest
from libs.auth.backend.models import User
from modules.workflows.backend.runs import service as runs_service


@dataclass(frozen=True)
class WorkflowSessionSpec:
    contract_id: str
    title: str
    session_types: list[str]
    allowed_actions: list[str]
    context_sections: list[str]
    instructions: list[str]
    examples: list[MCPContractExample] = field(default_factory=list)


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


RUN_ACTION_NAMES = {
    "context.get_request_summary",
    "context.get_request_context",
    "context.get_run_summary",
    "run.resolve_request",
    "run.escalate_to_supervisor",
}


def build_run_session_specs() -> dict[str, WorkflowSessionSpec]:
    return {
        "channel.request.response": WorkflowSessionSpec(
            contract_id="channel.request.response",
            title="Structured Channel Request Response",
            session_types=["channel.request.operator", "channel.request.supervisor"],
            allowed_actions=[
                "context.get_trigger_message",
                "context.get_request_summary",
                "context.get_request_context",
                "context.get_recent_messages",
                "context.get_participants",
                "context.get_run_summary",
                "run.resolve_request",
                "run.escalate_to_supervisor",
                "control.noop",
                "control.fail",
            ],
            context_sections=["trigger_message", "request_summary", "request_context", "recent_messages", "run_summary", "participants"],
            instructions=[
                "Respond to the active structured request only.",
                "Use run.resolve_request for the final workflow decision.",
                "Use run.escalate_to_supervisor when operator review should hand off to the supervisor.",
                "When using run.resolve_request with resolution=accept_output, include the decisive task output in payload.answers as plain strings or in payload.override_output.",
                "Do not send accept_output with an empty output payload.",
                "Do not substitute channel.post_message for the decision.",
                "Start with the loaded context only.",
                "If you need more context, call a read action first and do not mix read and write actions in one batch.",
            ],
            examples=[
                MCPContractExample(
                    summary="Load the full request context before deciding",
                    action={
                        "action": "context.get_request_context",
                        "target": {},
                        "payload": {},
                    },
                ),
                MCPContractExample(
                    summary="Accept the completed task output",
                    action={
                        "action": "run.resolve_request",
                        "target": {"request_message_id": "message-id"},
                        "payload": {
                            "resolution": "accept_output",
                            "answers": [
                                "Elite Fitness Đà Nẵng is located at Vĩnh Trung Plaza B, 255–257 Hùng Vương, Thanh Khê, Đà Nẵng. Sources: official site, Foody, GlobalGymBunny.",
                            ],
                        },
                    },
                ),
                MCPContractExample(
                    summary="Ask supervisor for review",
                    action={
                        "action": "run.escalate_to_supervisor",
                        "target": {"request_message_id": "message-id"},
                        "payload": {
                            "guidance": "Escalate this to supervisor with the missing identifier requirement.",
                        },
                    },
                )
            ],
        ),
        "workflow.escalation.review": WorkflowSessionSpec(
            contract_id="workflow.escalation.review",
            title="Workflow Escalation Review",
            session_types=["workflow.escalation.review"],
            allowed_actions=[
                "context.get_escalation_summary",
                "context.get_run_summary",
                "context.get_recent_messages",
                "escalation.resolve",
                "channel.post_message",
                "control.noop",
                "control.fail",
            ],
            context_sections=["escalation_summary", "run_summary", "recent_messages"],
            instructions=[
                "Resolve the escalation with the smallest decision that unblocks the workflow.",
                "Use channel.post_message only for side commentary, not as the resolution itself.",
                "If you need more context, call a read action first and do not mix read and write actions in one batch.",
            ],
        ),
        "workflow.run.followup": WorkflowSessionSpec(
            contract_id="workflow.run.followup",
            title="Workflow Run Follow-up",
            session_types=["workflow.run.followup"],
            allowed_actions=[
                "context.get_trigger_message",
                "context.get_run_summary",
                "context.get_recent_messages",
                "context.get_participants",
                "channel.post_message",
                "control.noop",
                "control.fail",
            ],
            context_sections=["trigger_message", "run_summary", "recent_messages", "participants"],
            instructions=[
                "Stay on the active run outcome, blocker, or next instruction.",
                "Do not redesign the workflow in this session type.",
                "If you need more context, call a read action first and do not mix read and write actions in one batch.",
            ],
        ),
        "telemetry.observe": WorkflowSessionSpec(
            contract_id="telemetry.observe",
            title="Telemetry Observe",
            session_types=["telemetry.observe"],
            allowed_actions=["context.get_trigger_message", "context.get_run_summary", "control.noop", "control.fail"],
            context_sections=["trigger_message", "run_summary"],
            instructions=[
                "This interaction is telemetry only.",
                "Do not post a reply unless explicitly instructed elsewhere.",
            ],
        ),
    }


def build_request_summary_action() -> MCPContractAction:
    return _context_action(
        name="context.get_request_summary",
        description="Load the active structured request summary.",
        section="request_summary",
        visibility="initial",
        output_schema=_object_schema(
            properties={
                "message_id": _string_schema(),
                "type": _string_schema(),
                "status": _string_schema(),
                "questions": _array_schema(_string_schema()),
                "assigned_to": _array_schema(_string_schema()),
                "response_schema": {"type": "object", "additionalProperties": True},
                "flow": {"type": "object", "additionalProperties": True},
            },
            required=["message_id", "type", "status", "questions"],
        ),
    )


def build_request_context_action() -> MCPContractAction:
    return _context_action(
        name="context.get_request_context",
        description="Load the full request context markdown.",
        section="request_context",
        visibility="initial",
        output_schema=_string_schema(),
    )


def build_run_summary_action(*, visibility: str) -> MCPContractAction:
    return _context_action(
        name="context.get_run_summary",
        description="Load the linked workflow run summary.",
        section="run_summary",
        visibility=visibility,
        output_schema=_object_schema(
            properties={
                "id": _string_schema(),
                "status": _string_schema(),
                "trigger": _string_schema(),
                "name": _string_schema(),
                "created_at": _string_schema(),
            },
            required=["id", "status"],
        ),
    )


def build_run_resolve_request_action() -> MCPContractAction:
    return MCPContractAction(
        name="run.resolve_request",
        description="Resolve the active workflow run request.",
        kind="write",
        target_schema=_object_schema(
            properties={"request_message_id": _string_schema()},
            required=["request_message_id"],
        ),
        payload_schema=_object_schema(
            properties={
                "resolution": _string_schema(enum=["accept_output", "override_output", "request_revision", "abort_run"]),
                "guidance": _string_schema(),
                "override_output": {"type": "object", "additionalProperties": True},
                "next_branch": _string_schema(),
                "answers": _array_schema(_string_schema()),
            },
            required=["resolution"],
        ),
    )


def build_run_escalate_to_supervisor_action() -> MCPContractAction:
    return MCPContractAction(
        name="run.escalate_to_supervisor",
        description="Escalate the active workflow run request to the supervisor.",
        kind="write",
        target_schema=_object_schema(
            properties={"request_message_id": _string_schema()},
            required=["request_message_id"],
        ),
        payload_schema=_object_schema(
            properties={
                "guidance": _string_schema(),
                "answers": _array_schema(_string_schema()),
            },
            additional_properties=False,
        ),
    )


def _request_summary(trigger_message: Any | None) -> dict[str, Any] | None:
    if trigger_message is None:
        return None
    metadata = trigger_message.metadata_ or {}
    request = metadata.get("request")
    if not isinstance(request, dict):
        return None
    if str(metadata.get("kind") or "") != "request":
        return None
    questions = request.get("questions") if isinstance(request.get("questions"), list) else []
    assigned_to = request.get("assigned_to") if isinstance(request.get("assigned_to"), list) else []
    flow = metadata.get("flow") if isinstance(metadata.get("flow"), dict) else None
    return {
        "message_id": str(trigger_message.id),
        "type": str(request.get("type") or "request"),
        "status": str(request.get("status") or "open"),
        "questions": [str(item).strip() for item in questions if str(item).strip()],
        "assigned_to": [str(item).strip() for item in assigned_to if str(item).strip()],
        "response_schema": request.get("response_schema"),
        "flow": flow,
    }


def resolve_run_session_contract(
    context: dict[str, Any],
    *,
    manifests: dict[str, MCPContractManifest],
) -> MCPContract | None:
    trigger_type = str(context.get("trigger_type") or "")
    channel_type = str(context.get("channel_type") or "")
    request = context.get("request")
    run_present = bool(context.get("run_present"))
    escalation_present = bool(context.get("escalation_present"))
    is_telemetry_trigger = bool(context.get("is_telemetry_trigger"))

    if is_telemetry_trigger and trigger_type == "message_posted" and (run_present or request is not None or channel_type == "run"):
        manifest = manifests["telemetry.observe"]
        return MCPContract(
            session_type="telemetry.observe",
            immediate_instruction="No reply is needed for telemetry-only updates.",
            mode_instructions=list(manifest.instructions),
            preferred_actions=list(manifest.allowed_actions),
            contract=manifest,
        )

    if request is not None and str(request.get("status") or "open") == "open":
        flow = request.get("flow") if isinstance(request, dict) else None
        target_role = str(flow.get("to_role") or "").strip() if isinstance(flow, dict) else ""
        session_type = "channel.request.supervisor" if target_role == "supervisor" else "channel.request.operator"
        manifest = manifests["channel.request.response"]
        question = None
        questions = request.get("questions") if isinstance(request, dict) else None
        if isinstance(questions, list) and questions:
            question = str(questions[0]).strip() or None
        mode_instructions = list(manifest.instructions)
        if session_type == "channel.request.operator":
            mode_instructions.append("As operator, escalate only when supervisor review is actually needed.")
        else:
            mode_instructions.append("As supervisor, decide rework, finalize output, or stop the run.")
        return MCPContract(
            session_type=session_type,
            immediate_instruction=question or "Respond to the active structured request in this channel.",
            mode_instructions=mode_instructions,
            preferred_actions=list(manifest.allowed_actions),
            contract=manifest,
        )

    if request is not None and trigger_type == "task_assigned":
        manifest = manifests["telemetry.observe"]
        request_status = str(request.get("status") or "open")
        return MCPContract(
            session_type="telemetry.observe",
            immediate_instruction="This assigned request is no longer active. Do not reply.",
            mode_instructions=[
                f"The assigned request is {request_status}.",
                "Do not post a reply or take workflow actions for a superseded or answered request.",
            ],
            preferred_actions=["control.noop"],
            contract=manifest,
        )

    if escalation_present or trigger_type == "escalation":
        manifest = manifests["workflow.escalation.review"]
        return MCPContract(
            session_type="workflow.escalation.review",
            immediate_instruction="Resolve the escalation with the smallest concrete decision that unblocks the run.",
            mode_instructions=list(manifest.instructions),
            preferred_actions=list(manifest.allowed_actions),
            contract=manifest,
        )

    if run_present or trigger_type == "run_event":
        manifest = manifests["workflow.run.followup"]
        return MCPContract(
            session_type="workflow.run.followup",
            immediate_instruction="Respond to the current workflow run state or ask only for the missing input needed to continue.",
            mode_instructions=list(manifest.instructions),
            preferred_actions=list(manifest.allowed_actions),
            contract=manifest,
        )

    return None


async def execute_run_action(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    current_user: User,
    member: Any,
    action_id: str,
    action_name: str,
    target: dict[str, Any],
    payload: dict[str, Any],
    loaded_channel_context: Any | None = None,
    fallback_run_id: str | None = None,
    fallback_trigger_message_id: str | None = None,
) -> MCPActionResult:
    if action_name == "context.get_request_summary":
        summary = _request_summary(loaded_channel_context.trigger_message if loaded_channel_context else None)
        if summary is None:
            raise ValueError("Active structured request not found")
        return MCPActionResult(action_id=action_id, status="applied", context_section="request_summary", output=summary)

    if action_name == "context.get_request_context":
        trigger_message = loaded_channel_context.trigger_message if loaded_channel_context else None
        summary = _request_summary(trigger_message)
        if summary is None:
            raise ValueError("Active structured request not found")
        metadata = trigger_message.metadata_ if trigger_message is not None else {}
        request = metadata.get("request") if isinstance(metadata, dict) else None
        return MCPActionResult(
            action_id=action_id,
            status="applied",
            context_section="request_context",
            output=str(request.get("context_markdown") or "") if isinstance(request, dict) else "",
        )

    if action_name == "context.get_run_summary":
        if not fallback_run_id:
            raise ValueError("Run not available for context read")
        run = await runs_service.get_run(db, fallback_run_id)
        if run is None or run.workspace_id != workspace_id:
            raise ValueError("Run not found")
        return MCPActionResult(
            action_id=action_id,
            status="applied",
            context_section="run_summary",
            output={
                "id": str(run.id),
                "status": run.status,
                "trigger": run.trigger,
                "name": run.name,
                "created_at": run.created_at.isoformat() if run.created_at else None,
            },
        )

    if action_name == "run.resolve_request":
        request_message_id = str(target.get("request_message_id") or fallback_trigger_message_id or "").strip()
        if not request_message_id:
            raise ValueError("request_message_id is required")
        channel = loaded_channel_context.channel if loaded_channel_context else None
        if channel is None:
            raise ValueError("Channel not available for request resolution")
        responded = await core_channels.respond_channel_message(
            db,
            workspace_id=workspace_id,
            channel_ref=str(channel.id),
            message_id=request_message_id,
            current_user=current_user,
            member=member,
            resolution=str(payload["resolution"]),
            guidance=payload.get("guidance"),
            override_output=payload.get("override_output"),
            next_branch=payload.get("next_branch"),
            answers=payload.get("answers"),
        )
        return MCPActionResult(
            action_id=action_id,
            status="applied",
            effect_ref={"kind": "channel_message", "id": str(responded.id)},
        )

    if action_name == "run.escalate_to_supervisor":
        request_message_id = str(target.get("request_message_id") or fallback_trigger_message_id or "").strip()
        if not request_message_id:
            raise ValueError("request_message_id is required")
        channel = loaded_channel_context.channel if loaded_channel_context else None
        if channel is None:
            raise ValueError("Channel not available for supervisor escalation")
        responded = await core_channels.respond_channel_message(
            db,
            workspace_id=workspace_id,
            channel_ref=str(channel.id),
            message_id=request_message_id,
            current_user=current_user,
            member=member,
            resolution="request_revision",
            guidance=payload.get("guidance"),
            answers=payload.get("answers"),
        )
        return MCPActionResult(
            action_id=action_id,
            status="applied",
            effect_ref={"kind": "channel_message", "id": str(responded.id)},
        )

    raise ValueError(f"Unsupported workflow run action: {action_name}")

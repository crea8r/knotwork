from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import channels as core_channels
from core.mcp.contracts.schemas import MCPActionResult, MCPContract, MCPContractAction, MCPContractManifest
from core.mcp.contracts.work_packet_context import LoadedWorkPacketContext
from libs.auth.backend.models import User
from modules.communication.backend import channels_service
from modules.communication.backend.channels_models import ChannelMessage
from modules.communication.backend.mcp_work_packet import build_communication_work_packet


def _object_schema(*, properties: dict, required: list[str] | None = None, additional_properties: bool = False) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": additional_properties,
    }


def _string_schema() -> dict:
    return {"type": "string"}


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


def _serialize_message(message: ChannelMessage) -> dict:
    return {
        "id": str(message.id),
        "created_at": message.created_at.isoformat() if message.created_at else None,
        "role": message.role,
        "author_type": message.author_type,
        "author_name": message.author_name,
        "content": message.content,
        "metadata": message.metadata_ or {},
    }


def _find_message(messages: list[ChannelMessage], message_id: str | None) -> ChannelMessage | None:
    if message_id:
        for message in messages:
            if str(message.id) == message_id:
                return message
    return messages[-1] if messages else None


def _channel_reply_manifest() -> MCPContractManifest:
    return MCPContractManifest(
        id="channel.reply",
        title="Channel Reply",
        owning_module="communication",
        session_types=["channel.reply"],
        allowed_actions=[
            "context.get_trigger_message",
            "context.get_recent_messages",
            "context.get_participants",
            "channel.post_message",
            "control.noop",
            "control.fail",
        ],
        context_sections=["trigger_message", "recent_messages", "participants"],
        instructions=[
            "Answer only the immediate message.",
            "Do not drift into unrelated workspace actions.",
            "Start with the loaded context only.",
            "If you need more context, call a read action first and do not mix read and write actions in one batch.",
        ],
        actions=[
            _context_action(
                name="context.get_trigger_message",
                description="Load the trigger message for this session.",
                section="trigger_message",
                visibility="initial",
                output_schema=_message_schema(),
            ),
            _context_action(
                name="context.get_recent_messages",
                description="Load recent channel messages around the trigger.",
                section="recent_messages",
                visibility="on_demand",
                output_schema={"type": "array", "items": _message_schema()},
            ),
            _context_action(
                name="context.get_participants",
                description="Load active channel participants.",
                section="participants",
                visibility="on_demand",
                output_schema={"type": "array", "items": _participant_schema()},
            ),
            MCPContractAction(
                name="channel.post_message",
                description="Reply to the channel.",
                kind="write",
                target_schema=_object_schema(properties={"channel_id": _string_schema()}, required=["channel_id"]),
                payload_schema=_object_schema(properties={"content": _string_schema(), "author_name": _string_schema(), "run_id": _string_schema()}, required=["content"]),
            ),
            MCPContractAction(
                name="control.noop",
                description="Take no external action.",
                kind="control",
                target_schema=_object_schema(properties={}),
                payload_schema=_object_schema(properties={"reason": _string_schema()}, required=["reason"]),
            ),
            MCPContractAction(
                name="control.fail",
                description="Fail explicitly when no safe reply exists.",
                kind="control",
                target_schema=_object_schema(properties={}),
                payload_schema=_object_schema(properties={"reason": _string_schema()}, required=["reason"]),
            ),
        ],
    )


def _generic_task_manifest() -> MCPContractManifest:
    return MCPContractManifest(
        id="generic.task",
        title="Generic Task",
        owning_module="communication",
        session_types=["generic.task"],
        allowed_actions=["channel.post_message", "control.noop", "control.fail"],
        context_sections=["trigger_message", "recent_messages"],
        instructions=[
            "Take the smallest useful next action.",
            "Stay scoped to the interaction that created the session.",
        ],
        actions=[
            MCPContractAction(
                name="channel.post_message",
                description="Reply in channel.",
                kind="write",
                target_schema=_object_schema(properties={"channel_id": _string_schema()}, required=["channel_id"]),
                payload_schema=_object_schema(properties={"content": _string_schema(), "author_name": _string_schema(), "run_id": _string_schema()}, required=["content"]),
            ),
            MCPContractAction(
                name="control.noop",
                description="Take no external action.",
                kind="control",
                target_schema=_object_schema(properties={}),
                payload_schema=_object_schema(properties={"reason": _string_schema()}, required=["reason"]),
            ),
            MCPContractAction(
                name="control.fail",
                description="Fail explicitly when no safe action exists.",
                kind="control",
                target_schema=_object_schema(properties={}),
                payload_schema=_object_schema(properties={"reason": _string_schema()}, required=["reason"]),
            ),
        ],
    )


class CommunicationMCPContractProvider:
    id = "communication.mcp-contracts"

    def __init__(self) -> None:
        self._manifests = [
            _channel_reply_manifest(),
            _generic_task_manifest(),
        ]

    def manifests(self) -> list[MCPContractManifest]:
        return list(self._manifests)

    def resolve(self, context: dict) -> MCPContract | None:
        trigger_type = str(context.get("trigger_type") or "")
        if trigger_type in {"message_posted", "mentioned_message", "task_assigned"}:
            manifest = next(item for item in self._manifests if item.id == "channel.reply")
            return MCPContract(
                session_type="channel.reply",
                immediate_instruction="Answer the immediate channel request with the next useful action only.",
                mode_instructions=list(manifest.instructions),
                preferred_actions=list(manifest.allowed_actions),
                contract=manifest,
            )

        manifest = next(item for item in self._manifests if item.id == "generic.task")
        return MCPContract(
            session_type="generic.task",
            immediate_instruction="Take the smallest useful Knotwork action that addresses the interaction.",
            mode_instructions=list(manifest.instructions),
            preferred_actions=list(manifest.allowed_actions),
            contract=manifest,
        )

    def resolve_loaded_context(self, loaded_context: LoadedWorkPacketContext) -> MCPContract | None:
        return self.resolve({"trigger_type": str(loaded_context.trigger.get("type") or "")})

    async def build_work_packet(
        self,
        *,
        loaded_context: LoadedWorkPacketContext,
        interaction: MCPContract,
    ) -> dict[str, Any]:
        return build_communication_work_packet(context=loaded_context, interaction=interaction)

    async def execute(
        self,
        db: AsyncSession,
        *,
        workspace_id: UUID,
        current_user: User,
        member: Any,
        contract_id: str,
        action_id: str,
        action_name: str,
        target: dict[str, Any],
        payload: dict[str, Any],
        fallback_run_id: str | None = None,
        fallback_source_channel_id: str | None = None,
        fallback_trigger_message_id: str | None = None,
    ) -> MCPActionResult:
        del member, contract_id

        if action_name == "control.noop":
            return MCPActionResult(
                action_id=action_id,
                status="applied",
                reason=str(payload.get("reason") or "noop"),
            )

        if action_name == "control.fail":
            return MCPActionResult(
                action_id=action_id,
                status="failed",
                reason=str(payload.get("reason") or "failed"),
            )

        if action_name.startswith("context.get_"):
            if not fallback_source_channel_id:
                raise ValueError("No channel available for context read")
            channel = await core_channels.get_channel(db, workspace_id, fallback_source_channel_id)
            if channel is None:
                raise ValueError("Channel not found")
            messages = await channels_service.list_messages(db, workspace_id, channel.id)
            participants = await channels_service.list_channel_participants(db, workspace_id, channel.id)
            if action_name == "context.get_trigger_message":
                trigger_message = _find_message(messages, fallback_trigger_message_id)
                if trigger_message is None:
                    raise ValueError("Trigger message not found")
                return MCPActionResult(
                    action_id=action_id,
                    status="applied",
                    context_section="trigger_message",
                    output=_serialize_message(trigger_message),
                )
            if action_name == "context.get_recent_messages":
                return MCPActionResult(
                    action_id=action_id,
                    status="applied",
                    context_section="recent_messages",
                    output=[_serialize_message(message) for message in messages[-6:]],
                )
            if action_name == "context.get_participants":
                return MCPActionResult(
                    action_id=action_id,
                    status="applied",
                    context_section="participants",
                    output=[
                        {
                            "participant_id": str(participant["participant_id"]),
                            "display_name": participant.get("display_name"),
                            "kind": participant.get("kind"),
                            "mention_handle": participant.get("mention_handle"),
                            "contribution_brief": participant.get("contribution_brief"),
                            "availability_status": participant.get("availability_status") or "available",
                            "capacity_level": participant.get("capacity_level") or "open",
                            "subscribed": participant.get("subscribed", True),
                        }
                        for participant in participants[:8]
                        if participant.get("subscribed", True) is not False
                    ],
                )

        if action_name == "channel.post_message":
            posted = await core_channels.post_message(
                db,
                workspace_id=workspace_id,
                channel_ref=str(target["channel_id"]),
                content=str(payload["content"]),
                author_name=str(payload.get("author_name") or current_user.name or "Agent"),
                run_id=str(payload.get("run_id") or fallback_run_id or "") or None,
            )
            return MCPActionResult(
                action_id=action_id,
                status="applied",
                effect_ref={"kind": "channel_message", "id": str(posted.id)},
            )

        raise ValueError(f"Unsupported communication MCP action: {action_name}")

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import channels as core_channels
from core.mcp.contracts.schemas import MCPActionResult
from libs.auth.backend.models import User
from modules.communication.backend import channels_service
from modules.workflows.backend.runs.escalations_models import Escalation


def _serialize_message(message: Any) -> dict[str, Any]:
    return {
        "id": str(message.id),
        "created_at": message.created_at.isoformat() if message.created_at else None,
        "role": message.role,
        "author_type": message.author_type,
        "author_name": message.author_name,
        "content": message.content,
        "metadata": message.metadata_ or {},
    }


def _find_message(messages: list[Any], message_id: str | None) -> Any | None:
    if message_id:
        for message in messages:
            if str(message.id) == message_id:
                return message
    return messages[-1] if messages else None


async def execute_communication_action(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    current_user: User,
    member: Any,
    action_id: str,
    action_name: str,
    target: dict[str, Any],
    payload: dict[str, Any],
    fallback_run_id: str | None = None,
    fallback_source_channel_id: str | None = None,
    fallback_trigger_message_id: str | None = None,
) -> MCPActionResult:
    del member

    if action_name == "control.noop":
        return MCPActionResult(action_id=action_id, status="applied", reason=str(payload.get("reason") or "noop"))

    if action_name == "control.fail":
        return MCPActionResult(action_id=action_id, status="failed", reason=str(payload.get("reason") or "failed"))

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

        if action_name == "context.get_escalation_summary":
            trigger_message = _find_message(messages, fallback_trigger_message_id)
            escalation_id = None
            if trigger_message is not None:
                metadata = trigger_message.metadata_ or {}
                request = metadata.get("request")
                if isinstance(request, dict):
                    escalation_id = str(request.get("escalation_id") or "").strip() or None
                escalation_id = escalation_id or (str(metadata.get("escalation_id") or "").strip() or None)
            if not escalation_id:
                raise ValueError("Escalation not available for context read")
            escalation = await db.get(Escalation, UUID(escalation_id))
            if escalation is None or escalation.workspace_id != workspace_id:
                raise ValueError("Escalation not found")
            return MCPActionResult(
                action_id=action_id,
                status="applied",
                context_section="escalation_summary",
                output={"id": str(escalation.id), "type": escalation.type, "status": escalation.status},
            )

    if action_name == "escalation.resolve":
        await core_channels.resolve_escalation_action(
            db,
            workspace_id=workspace_id,
            escalation_id=str(target["escalation_id"]),
            current_user=current_user,
            member=member,
            resolution=str(payload["resolution"]),
            guidance=payload.get("guidance"),
            override_output=payload.get("override_output"),
            next_branch=payload.get("next_branch"),
            answers=payload.get("answers"),
            channel_id=str(payload.get("channel_id") or "") or None,
        )
        return MCPActionResult(
            action_id=action_id,
            status="applied",
            reason=f"resolved escalation {target['escalation_id']}",
        )

    raise ValueError(f"Unsupported communication MCP action: {action_name}")

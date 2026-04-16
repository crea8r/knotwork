from __future__ import annotations

from typing import Any

from core.mcp.contracts.schemas import MCPContract
from core.mcp.contracts.work_packet_builder import base_work_packet, trim_packet_context
from core.mcp.contracts.work_packet_context import LoadedWorkPacketContext, serialize_message, serialize_participant


def build_communication_work_packet(
    *,
    context: LoadedWorkPacketContext,
    interaction: MCPContract,
) -> dict[str, Any]:
    context_hints = [
        {"kind": "query", "value": "channel.latest_messages"} if context.channel is not None else None,
        {"kind": "query", "value": "channel.participants"} if context.channel is not None else None,
        {"kind": "query", "value": "channel.assets"} if context.channel is not None else None,
        {"kind": "query", "value": "objective.chain"} if context.objective_chain else None,
    ]
    packet = base_work_packet(
        context,
        interaction,
        context_hints=[item for item in context_hints if item is not None],
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
    if context.primary_asset is not None:
        packet["primary_subject"] = {
            "kind": str(context.primary_asset.get("asset_type")),
            "id": str(context.primary_asset.get("asset_id")),
            "label": str(
                context.primary_asset.get("display_name")
                or context.primary_asset.get("path")
                or context.primary_asset.get("asset_id")
            ),
            "path": context.primary_asset.get("path"),
        }
    return trim_packet_context(packet, interaction.contract)

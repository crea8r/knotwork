from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import channels as core_channels
from core.api import knowledge as core_knowledge
from core.mcp.contracts.schemas import MCPActionResult, MCPContract, MCPContractAction, MCPContractManifest
from core.mcp.contracts.work_packet_context import LoadedWorkPacketContext, first_non_empty, trigger_asset_type
from libs.auth.backend.models import User
from modules.assets.backend.mcp_work_packet import build_assets_work_packet


def _object_schema(*, properties: dict, required: list[str] | None = None, additional_properties: bool = False) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": additional_properties,
    }


def _string_schema() -> dict:
    return {"type": "string"}


class AssetsMCPContractProvider:
    id = "assets.mcp-contracts"

    def __init__(self) -> None:
        self._manifest = MCPContractManifest(
            id="asset.change.request",
            title="Asset Change Request",
            owning_module="assets",
            session_types=["asset.change.request"],
            allowed_actions=["knowledge.propose_change", "channel.post_message", "control.noop", "control.fail"],
            context_sections=["asset_summaries", "primary_subject", "recent_messages", "trigger_message"],
            instructions=[
                "Keep the response scoped to the asset request.",
                "Prefer a concrete proposed change over broad discussion.",
            ],
            actions=[
                MCPContractAction(
                    name="knowledge.propose_change",
                    description="Propose a targeted asset change.",
                    target_schema=_object_schema(properties={"path": _string_schema()}, required=["path"]),
                    payload_schema=_object_schema(
                        properties={
                            "proposed_content": _string_schema(),
                            "reason": _string_schema(),
                            "run_id": _string_schema(),
                            "node_id": _string_schema(),
                            "agent_ref": _string_schema(),
                            "source_channel_id": _string_schema(),
                            "action_type": _string_schema(),
                            "target_type": _string_schema(),
                            "payload": {"type": "object", "additionalProperties": True},
                        },
                        required=["proposed_content", "reason"],
                    ),
                ),
                MCPContractAction(
                    name="channel.post_message",
                    description="Ask a clarifying question in channel.",
                    target_schema=_object_schema(properties={"channel_id": _string_schema()}, required=["channel_id"]),
                    payload_schema=_object_schema(properties={"content": _string_schema(), "author_name": _string_schema(), "run_id": _string_schema()}, required=["content"]),
                ),
                MCPContractAction(
                    name="control.noop",
                    description="Take no external action.",
                    target_schema=_object_schema(properties={}),
                    payload_schema=_object_schema(properties={"reason": _string_schema()}, required=["reason"]),
                ),
                MCPContractAction(
                    name="control.fail",
                    description="Fail explicitly when no safe proposal exists.",
                    target_schema=_object_schema(properties={}),
                    payload_schema=_object_schema(properties={"reason": _string_schema()}, required=["reason"]),
                ),
            ],
        )

    def manifests(self) -> list[MCPContractManifest]:
        return [self._manifest]

    def resolve(self, context: dict) -> MCPContract | None:
        trigger_type = str(context.get("trigger_type") or "")
        asset_type = str(context.get("asset_type") or "")
        if asset_type not in {"file", "folder"} and trigger_type != "knowledge_change":
            return None
        return MCPContract(
            session_type="asset.change.request",
            immediate_instruction="Handle the asset change directly and keep the proposal concrete.",
            mode_instructions=list(self._manifest.instructions),
            preferred_actions=list(self._manifest.allowed_actions),
            contract=self._manifest,
        )

    def resolve_loaded_context(self, loaded_context: LoadedWorkPacketContext) -> MCPContract | None:
        return self.resolve(
            {
                "trigger_type": str(loaded_context.trigger.get("type") or ""),
                "asset_type": (
                    str(loaded_context.primary_asset.get("asset_type"))
                    if loaded_context.primary_asset is not None
                    else first_non_empty(trigger_asset_type(loaded_context.trigger))
                ),
            }
        )

    async def build_work_packet(
        self,
        *,
        loaded_context: LoadedWorkPacketContext,
        interaction: MCPContract,
    ) -> dict[str, Any]:
        return build_assets_work_packet(context=loaded_context, interaction=interaction)

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
        del member, contract_id, fallback_trigger_message_id

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

        if action_name == "knowledge.propose_change":
            proposal = await core_knowledge.create_change(
                db,
                workspace_id=workspace_id,
                path=str(target["path"]),
                proposed_content=str(payload["proposed_content"]),
                reason=str(payload["reason"]),
                run_id=str(payload.get("run_id") or fallback_run_id or "") or None,
                node_id=str(payload.get("node_id") or "") or None,
                agent_ref=str(payload.get("agent_ref") or current_user.name or "") or None,
                source_channel_id=str(payload.get("source_channel_id") or fallback_source_channel_id or "") or None,
                action_type=str(payload.get("action_type") or "update_content"),
                target_type=str(payload.get("target_type") or "file"),
                payload=payload.get("payload") if isinstance(payload.get("payload"), dict) else {},
            )
            return MCPActionResult(
                action_id=action_id,
                status="applied",
                reason=f"created knowledge change {proposal.id}",
            )

        raise ValueError(f"Unsupported assets MCP action: {action_name}")

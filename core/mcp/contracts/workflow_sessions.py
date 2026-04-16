from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import graphs as core_graphs
from core.mcp.contracts.schemas import (
    MCPActionResult,
    MCPContract,
    MCPContractAction,
    MCPContractManifest,
)
from libs.auth.backend.models import User
from modules.communication.backend.mcp_contracts import (
    COMMUNICATION_ACTION_NAMES,
    build_channel_post_message_action,
    build_control_fail_action,
    build_control_noop_action,
    build_escalation_resolve_action,
    build_escalation_summary_action,
    build_participants_context_action,
    build_recent_messages_context_action,
    build_trigger_message_context_action,
    execute_communication_action,
)
from modules.workflows.backend.mcp_contracts import (
    WORKFLOW_ACTION_NAMES,
    build_workflow_session_specs,
    execute_workflow_action,
    resolve_workflow_session_contract,
)
from modules.workflows.backend.mcp_contracts.context import load_channel_context
from modules.workflows.backend.mcp_contracts.work_packet import build_workflows_work_packet, workflow_resolution_context
from modules.workflows.backend.mcp_contracts.run_contracts import (
    build_message_respond_action,
    build_request_context_action,
    build_request_summary_action,
    build_run_summary_action,
)
from modules.workflows.backend.mcp_contracts.workflow_edit_contracts import (
    build_graph_apply_delta_action,
    build_graph_summary_action,
    build_graph_update_root_draft_action,
)
from core.mcp.contracts.work_packet_context import LoadedWorkPacketContext


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


COMPOSED_WORKFLOW_PROTOCOL_IDS = {
    "channel.request.response",
    "workflow.escalation.review",
    "workflow.run.followup",
    "workflow.edit",
    "telemetry.observe",
}


def _asset_summaries_action() -> MCPContractAction:
    return _context_action(
        name="context.get_asset_summaries",
        description="Load bound assets for the workflow session.",
        section="asset_summaries",
        visibility="on_demand",
        output_schema={
            "type": "array",
            "items": _object_schema(
                properties={
                    "asset_type": _string_schema(),
                    "asset_id": _string_schema(),
                    "display_name": _string_schema(),
                    "path": _string_schema(),
                    "status": _string_schema(),
                },
                required=["asset_type", "asset_id", "display_name"],
            ),
        },
    )


def _primary_subject_action() -> MCPContractAction:
    return _context_action(
        name="context.get_primary_subject",
        description="Load the primary workflow subject tied to this session.",
        section="primary_subject",
        visibility="initial",
        output_schema=_object_schema(
            properties={"kind": _string_schema(), "id": _string_schema(), "label": _string_schema(), "path": _string_schema()},
            required=["kind", "id", "label"],
        ),
    )


class ComposedWorkflowMCPContractProvider:
    id = "core.workflow-session-contracts"

    def __init__(self) -> None:
        specs = build_workflow_session_specs()
        self._manifests = {
            "channel.request.response": MCPContractManifest(
                id="channel.request.response",
                title=specs["channel.request.response"].title,
                owning_module="workflows",
                session_types=list(specs["channel.request.response"].session_types),
                allowed_actions=list(specs["channel.request.response"].allowed_actions),
                context_sections=list(specs["channel.request.response"].context_sections),
                instructions=list(specs["channel.request.response"].instructions),
                actions=[
                    build_trigger_message_context_action(description="Load the trigger message for this request session."),
                    build_request_summary_action(),
                    build_request_context_action(),
                    build_recent_messages_context_action(description="Load recent channel messages around the request."),
                    build_participants_context_action(description="Load active channel participants for the request."),
                    build_run_summary_action(visibility="on_demand"),
                    build_message_respond_action(),
                    build_control_noop_action(),
                    build_control_fail_action(description="Fail explicitly when no safe decision can be produced."),
                ],
                examples=list(specs["channel.request.response"].examples),
            ),
            "workflow.escalation.review": MCPContractManifest(
                id="workflow.escalation.review",
                title=specs["workflow.escalation.review"].title,
                owning_module="workflows",
                session_types=list(specs["workflow.escalation.review"].session_types),
                allowed_actions=list(specs["workflow.escalation.review"].allowed_actions),
                context_sections=list(specs["workflow.escalation.review"].context_sections),
                instructions=list(specs["workflow.escalation.review"].instructions),
                actions=[
                    build_escalation_summary_action(),
                    build_run_summary_action(visibility="initial"),
                    build_recent_messages_context_action(description="Load recent channel messages around the escalation."),
                    build_escalation_resolve_action(),
                    build_channel_post_message_action(description="Post a supporting note in the linked channel."),
                    build_control_noop_action(),
                    build_control_fail_action(description="Fail explicitly when the escalation cannot be resolved safely."),
                ],
            ),
            "workflow.run.followup": MCPContractManifest(
                id="workflow.run.followup",
                title=specs["workflow.run.followup"].title,
                owning_module="workflows",
                session_types=list(specs["workflow.run.followup"].session_types),
                allowed_actions=list(specs["workflow.run.followup"].allowed_actions),
                context_sections=list(specs["workflow.run.followup"].context_sections),
                instructions=list(specs["workflow.run.followup"].instructions),
                actions=[
                    build_trigger_message_context_action(description="Load the trigger message for this run follow-up."),
                    build_run_summary_action(visibility="initial"),
                    build_recent_messages_context_action(description="Load recent channel messages around the run."),
                    build_participants_context_action(description="Load active run channel participants."),
                    build_channel_post_message_action(description="Reply in the run channel."),
                    build_control_noop_action(),
                    build_control_fail_action(description="Fail explicitly when no safe follow-up exists."),
                ],
            ),
            "workflow.edit": MCPContractManifest(
                id="workflow.edit",
                title=specs["workflow.edit"].title,
                owning_module="workflows",
                session_types=list(specs["workflow.edit"].session_types),
                allowed_actions=list(specs["workflow.edit"].allowed_actions),
                context_sections=list(specs["workflow.edit"].context_sections),
                instructions=list(specs["workflow.edit"].instructions),
                actions=[
                    _primary_subject_action(),
                    build_graph_summary_action(),
                    build_recent_messages_context_action(description="Load recent consultation messages."),
                    _asset_summaries_action(),
                    build_graph_apply_delta_action(),
                    build_graph_update_root_draft_action(),
                    build_channel_post_message_action(description="Summarize the workflow change in channel."),
                    build_control_noop_action(),
                    build_control_fail_action(description="Fail explicitly when no safe change can be made."),
                ],
            ),
            "telemetry.observe": MCPContractManifest(
                id="telemetry.observe",
                title=specs["telemetry.observe"].title,
                owning_module="workflows",
                session_types=list(specs["telemetry.observe"].session_types),
                allowed_actions=list(specs["telemetry.observe"].allowed_actions),
                context_sections=list(specs["telemetry.observe"].context_sections),
                instructions=list(specs["telemetry.observe"].instructions),
                actions=[
                    build_trigger_message_context_action(description="Load the telemetry trigger message."),
                    build_run_summary_action(visibility="initial"),
                    build_control_noop_action(description="Acknowledge without external action."),
                    build_control_fail_action(description="Fail explicitly when telemetry cannot be interpreted safely."),
                ],
            ),
        }

    def manifests(self) -> list[MCPContractManifest]:
        return list(self._manifests.values())

    def resolve(self, context: dict[str, Any]) -> MCPContract | None:
        return resolve_workflow_session_contract(context, manifests=self._manifests)

    def resolve_loaded_context(self, loaded_context: LoadedWorkPacketContext) -> MCPContract | None:
        return resolve_workflow_session_contract(workflow_resolution_context(loaded_context), manifests=self._manifests)

    async def build_work_packet(
        self,
        *,
        loaded_context: LoadedWorkPacketContext,
        interaction: MCPContract,
    ) -> dict[str, Any]:
        return build_workflows_work_packet(context=loaded_context, interaction=interaction)

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
        loaded_channel_context = None
        if action_name in {
            "context.get_request_summary",
            "context.get_request_context",
            "context.get_graph_summary",
            "context.get_asset_summaries",
            "context.get_primary_subject",
        }:
            loaded_channel_context = await load_channel_context(
                db,
                workspace_id=workspace_id,
                source_channel_id=fallback_source_channel_id,
                trigger_message_id=fallback_trigger_message_id,
            )

        if action_name in COMMUNICATION_ACTION_NAMES:
            return await execute_communication_action(
                db,
                workspace_id=workspace_id,
                current_user=current_user,
                member=member,
                action_id=action_id,
                action_name=action_name,
                target=target,
                payload=payload,
                fallback_run_id=fallback_run_id,
                fallback_source_channel_id=fallback_source_channel_id,
                fallback_trigger_message_id=fallback_trigger_message_id,
            )

        if action_name == "context.get_asset_summaries":
            return MCPActionResult(
                action_id=action_id,
                status="applied",
                context_section="asset_summaries",
                output=[
                    {
                        "asset_type": row["asset_type"],
                        "asset_id": row["asset_id"],
                        "display_name": row["display_name"],
                        "path": row["path"],
                        "status": row["status"],
                    }
                    for row in (loaded_channel_context.assets if loaded_channel_context else [])[:8]
                ],
            )

        if action_name == "context.get_primary_subject":
            channel = loaded_channel_context.channel if loaded_channel_context else None
            if channel is not None and channel.graph_id:
                graph = await core_graphs.get_graph(db, channel.graph_id)
                if graph is not None:
                    return MCPActionResult(
                        action_id=action_id,
                        status="applied",
                        context_section="primary_subject",
                        output={"kind": "workflow", "id": str(graph.id), "label": graph.name},
                    )
            if loaded_channel_context and loaded_channel_context.assets:
                asset = loaded_channel_context.assets[0]
                return MCPActionResult(
                    action_id=action_id,
                    status="applied",
                    context_section="primary_subject",
                    output={
                        "kind": str(asset.get("asset_type")),
                        "id": str(asset.get("asset_id")),
                        "label": str(asset.get("display_name") or asset.get("path") or asset.get("asset_id")),
                        "path": asset.get("path"),
                    },
                )
            raise ValueError("Primary subject not available")

        if action_name in WORKFLOW_ACTION_NAMES:
            return await execute_workflow_action(
                db,
                workspace_id=workspace_id,
                current_user=current_user,
                member=member,
                action_id=action_id,
                action_name=action_name,
                target=target,
                payload=payload,
                loaded_channel_context=loaded_channel_context,
                fallback_run_id=fallback_run_id,
            )

        raise ValueError(f"Unsupported composed workflow MCP contract '{contract_id}' action: {action_name}")

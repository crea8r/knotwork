from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import graphs as core_graphs
from core.mcp.contracts.schemas import MCPActionResult, MCPContract, MCPContractAction, MCPContractExample, MCPContractManifest
from libs.auth.backend.models import User


@dataclass(frozen=True)
class WorkflowEditSessionSpec:
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


WORKFLOW_EDIT_ACTION_NAMES = {
    "context.get_graph_summary",
    "graph.apply_delta",
    "graph.update_root_draft",
}


def build_workflow_edit_session_specs() -> dict[str, WorkflowEditSessionSpec]:
    return {
        "workflow.edit": WorkflowEditSessionSpec(
            contract_id="workflow.edit",
            title="Workflow Edit",
            session_types=["workflow.edit"],
            allowed_actions=[
                "context.get_primary_subject",
                "context.get_graph_summary",
                "context.get_recent_messages",
                "context.get_asset_summaries",
                "graph.apply_delta",
                "graph.update_root_draft",
                "channel.post_message",
                "control.noop",
                "control.fail",
            ],
            context_sections=["graph_summary", "recent_messages", "asset_summaries", "primary_subject"],
            instructions=[
                "Modify only the workflow surface tied to this session.",
                "Prefer incremental graph.apply_delta over replacing the whole draft.",
                "If you need more context, call a read action first and do not mix read and write actions in one batch.",
            ],
        )
    }


def build_graph_summary_action() -> MCPContractAction:
    return _context_action(
        name="context.get_graph_summary",
        description="Load the workflow graph summary.",
        section="graph_summary",
        visibility="initial",
        output_schema=_object_schema(
            properties={
                "id": _string_schema(),
                "name": _string_schema(),
                "path": _string_schema(),
                "status": _string_schema(),
                "default_model": _string_schema(),
                "has_root_draft": {"type": "boolean"},
            },
            required=["id", "name", "path", "status", "has_root_draft"],
        ),
    )


def build_graph_apply_delta_action() -> MCPContractAction:
    return MCPContractAction(
        name="graph.apply_delta",
        description="Apply an incremental workflow change.",
        kind="write",
        target_schema=_object_schema(properties={"graph_id": _string_schema()}, required=["graph_id"]),
        payload_schema=_object_schema(
            properties={"delta": {"type": "object", "additionalProperties": True}, "note": _string_schema()},
            required=["delta"],
        ),
    )


def build_graph_update_root_draft_action() -> MCPContractAction:
    return MCPContractAction(
        name="graph.update_root_draft",
        description="Replace the full workflow draft when necessary.",
        kind="write",
        target_schema=_object_schema(properties={"graph_id": _string_schema()}, required=["graph_id"]),
        payload_schema=_object_schema(
            properties={"definition": {"type": "object", "additionalProperties": True}, "note": _string_schema()},
            required=["definition"],
        ),
    )


def resolve_workflow_edit_session_contract(
    context: dict[str, Any],
    *,
    manifests: dict[str, MCPContractManifest],
) -> MCPContract | None:
    channel_type = str(context.get("channel_type") or "")
    graph_present = bool(context.get("graph_present"))
    asset_type = str(context.get("asset_type") or "")

    if asset_type == "workflow" or channel_type in {"workflow", "consultation"} or graph_present:
        manifest = manifests["workflow.edit"]
        return MCPContract(
            session_type="workflow.edit",
            immediate_instruction="Handle the workflow editing request directly.",
            mode_instructions=list(manifest.instructions),
            preferred_actions=list(manifest.allowed_actions),
            contract=manifest,
        )

    return None


async def execute_workflow_edit_action(
    db: AsyncSession,
    *,
    current_user: User,
    action_id: str,
    action_name: str,
    target: dict[str, Any],
    payload: dict[str, Any],
    loaded_channel_context: Any | None = None,
) -> MCPActionResult:
    if action_name == "context.get_graph_summary":
        channel = loaded_channel_context.channel if loaded_channel_context else None
        if channel is None or not channel.graph_id:
            raise ValueError("Graph not available for context read")
        graph = await core_graphs.get_graph(db, channel.graph_id)
        if graph is None:
            raise ValueError("Graph not found")
        root_draft = await core_graphs.get_any_draft(db, channel.graph_id)
        return MCPActionResult(
            action_id=action_id,
            status="applied",
            context_section="graph_summary",
            output={
                "id": str(graph.id),
                "name": graph.name,
                "path": core_graphs.graph_asset_path(graph),
                "status": graph.status,
                "default_model": graph.default_model,
                "has_root_draft": root_draft is not None,
            },
        )

    if action_name == "graph.update_root_draft":
        draft = await core_graphs.update_root_draft(
            db,
            graph_id=UUID(str(target["graph_id"])),
            definition=payload["definition"],
            created_by=current_user.id,
        )
        return MCPActionResult(action_id=action_id, status="applied", reason=f"updated graph root draft {draft.id}")

    if action_name == "graph.apply_delta":
        draft = await core_graphs.apply_delta_to_root_draft(
            db,
            graph_id=UUID(str(target["graph_id"])),
            delta=payload["delta"],
            created_by=current_user.id,
        )
        return MCPActionResult(action_id=action_id, status="applied", reason=f"applied graph delta {draft.id}")

    raise ValueError(f"Unsupported workflow edit action: {action_name}")

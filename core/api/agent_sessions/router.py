from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.agent_sessions.work_packets import build_work_packet
from core.mcp.contracts.registry import execute_mcp_action
from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User
from libs.database import get_db
from modules.admin.backend.workspaces_models import WorkspaceMember

router = APIRouter(prefix="/workspaces", tags=["mcp"])


class WorkPacketTriggerIn(BaseModel):
    type: str
    delivery_id: str | None = None
    channel_id: str | None = None
    detail: dict | None = None
    run_id: str | None = None
    escalation_id: str | None = None
    proposal_id: str | None = None
    message_id: str | None = None
    asset_type: str | None = None
    asset_id: str | None = None
    asset_path: str | None = None
    title: str | None = None
    subtitle: str | None = None


class WorkPacketRequest(BaseModel):
    task_id: str
    session_name: str | None = None
    legacy_user_prompt: str | None = None
    trigger: WorkPacketTriggerIn


class WorkPacketResponse(BaseModel):
    version: Literal["knotwork.mcp/v1"]
    task_id: str
    session_type: str
    trigger: dict
    mcp_contract: dict
    task_focus: dict
    workspace: dict
    agent: dict
    refs: dict
    continuation_key: dict
    allowed_actions: list[str]
    work_policy: dict
    message_response_policy: dict | None = None
    channel_summary: dict | None = None
    trigger_message: dict | None = None
    recent_messages: list[dict]
    participants: list[dict]
    asset_summaries: list[dict]
    primary_subject: dict | None = None
    objective_chain: list[dict]
    graph_summary: dict | None = None
    run_summary: dict | None = None
    escalation_summary: dict | None = None
    request_summary: dict | None = None
    request_context: str | None = None
    context_hints: list[dict]
    legacy_task_context: str | None = None


class MCPActionRequest(BaseModel):
    contract_id: str
    contract_checksum: str
    action: dict
    fallback_run_id: str | None = None
    fallback_source_channel_id: str | None = None
    fallback_trigger_message_id: str | None = None


class MCPActionResponse(BaseModel):
    action_id: str
    status: str
    reason: str | None = None
    effect_ref: dict | None = None
    context_section: str | None = None
    output: dict | list | str | int | float | bool | None = None


@router.post("/{workspace_id}/mcp/work-packets", response_model=WorkPacketResponse)
async def create_mcp_work_packet(
    workspace_id: UUID,
    data: WorkPacketRequest,
    current_user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> WorkPacketResponse:
    try:
        packet = await build_work_packet(
            db,
            workspace_id=workspace_id,
            current_user=current_user,
            member=member,
            task_id=data.task_id,
            trigger=data.trigger.model_dump(),
            session_name=data.session_name,
            legacy_user_prompt=data.legacy_user_prompt,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"build_mcp_work_packet failed: {exc.__class__.__name__}: {exc}",
        ) from exc
    return WorkPacketResponse.model_validate(packet)


@router.post("/{workspace_id}/mcp/actions/execute", response_model=MCPActionResponse)
async def execute_mcp_contract_action(
    workspace_id: UUID,
    data: MCPActionRequest,
    current_user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> MCPActionResponse:
    try:
        result = await execute_mcp_action(
            db,
            workspace_id=workspace_id,
            current_user=current_user,
            member=member,
            contract_id=data.contract_id,
            contract_checksum=data.contract_checksum,
            action=data.action,
            fallback_run_id=data.fallback_run_id,
            fallback_source_channel_id=data.fallback_source_channel_id,
            fallback_trigger_message_id=data.fallback_trigger_message_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"execute_mcp_action failed: {exc.__class__.__name__}: {exc}",
        ) from exc
    return MCPActionResponse.model_validate(result.model_dump(mode="json"))

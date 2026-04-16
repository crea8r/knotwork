"""Thin MCP work-packet coordinator for agent sessions."""

from __future__ import annotations

from typing import Any, cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.mcp.contracts.registry import resolve_mcp_contract_for_work_packet
from core.mcp.contracts.work_packet_context import load_work_packet_context
from libs.auth.backend.models import User
from modules.admin.backend.workspaces_models import WorkspaceMember


async def build_work_packet(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    current_user: User,
    member: WorkspaceMember,
    task_id: str,
    trigger: dict[str, Any],
    session_name: str | None = None,
    legacy_user_prompt: str | None = None,
) -> dict[str, Any]:
    loaded_context = await load_work_packet_context(
        db,
        workspace_id=workspace_id,
        current_user=current_user,
        member=member,
        task_id=task_id,
        trigger=trigger,
        session_name=session_name,
        legacy_user_prompt=legacy_user_prompt,
    )
    resolved = resolve_mcp_contract_for_work_packet(loaded_context)
    builder = getattr(resolved.provider, "build_work_packet", None)
    if not callable(builder):
        raise NotImplementedError(f"MCP contract provider '{resolved.provider.id}' cannot build work packets")
    return await cast(Any, builder)(loaded_context=loaded_context, interaction=resolved.contract)

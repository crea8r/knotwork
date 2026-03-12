"""CRUD operations for RegisteredAgent."""
from __future__ import annotations

from uuid import UUID

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.registered_agents.models import RegisteredAgent
from knotwork.registered_agents.schemas import (
    ActivateAgentRequest,
    AgentConnectivityUpdate,
    ArchiveAgentRequest,
    DeactivateAgentRequest,
    RegisteredAgentCreate,
    RegisteredAgentOut,
    RegisteredAgentUpdate,
)
from knotwork.registered_agents.service_utils import _get_agent_row, _mask_hint, _now, _to_out


async def list_agents(
    db: AsyncSession,
    workspace_id: UUID,
    q: str | None = None,
    provider: str | None = None,
    status_filter: str | None = None,
    preflight_status: str | None = None,
) -> list[RegisteredAgentOut]:
    stmt = select(RegisteredAgent).where(RegisteredAgent.workspace_id == workspace_id)
    stmt = stmt.where(RegisteredAgent.status != "archived")
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(sa.func.lower(RegisteredAgent.display_name).like(like))
    if provider:
        stmt = stmt.where(RegisteredAgent.provider == provider)
    if status_filter:
        stmt = stmt.where(RegisteredAgent.status == status_filter)
    if preflight_status:
        stmt = stmt.where(RegisteredAgent.preflight_status == preflight_status)
    stmt = stmt.order_by(desc(RegisteredAgent.updated_at), desc(RegisteredAgent.created_at))
    result = await db.execute(stmt)
    return [_to_out(ra) for ra in result.scalars()]


async def create_agent(
    db: AsyncSession, workspace_id: UUID, data: RegisteredAgentCreate
) -> RegisteredAgentOut:
    api_key = data.api_key
    credential_type = None
    credential_hint = None
    credential_ciphertext = None

    if data.credentials:
        credential_type = data.credentials.type
        api_key = data.credentials.api_key or api_key
    if api_key:
        credential_type = credential_type or "api_key"
        credential_hint = _mask_hint(api_key)
        credential_ciphertext = api_key  # S8 MVP (no KMS wiring yet)

    ra = RegisteredAgent(
        workspace_id=workspace_id,
        display_name=data.display_name,
        avatar_url=data.avatar_url,
        provider=data.provider,
        agent_ref=data.agent_ref,
        api_key=api_key,
        endpoint=data.endpoint,
        status="inactive",
        is_active=False,
        credential_type=credential_type,
        credential_hint=credential_hint,
        credential_ciphertext=credential_ciphertext,
        capability_freshness="needs_refresh",
        preflight_status="never_run",
        updated_at=_now(),
    )
    db.add(ra)
    await db.commit()
    await db.refresh(ra)

    if data.activate_after_preflight and data.provider != "openclaw":
        ra.status = "active"
        ra.is_active = True
        ra.updated_at = _now()
        await db.commit()
        await db.refresh(ra)

    return _to_out(ra)


async def get_agent(db: AsyncSession, workspace_id: UUID, agent_id: UUID) -> RegisteredAgentOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    return _to_out(ra)


async def update_agent(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, data: RegisteredAgentUpdate
) -> RegisteredAgentOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    payload = data.model_dump(exclude_unset=True)
    if "display_name" in payload:
        ra.display_name = payload["display_name"]
    if "avatar_url" in payload:
        ra.avatar_url = payload["avatar_url"]
    ra.updated_at = _now()
    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def update_connectivity(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, data: AgentConnectivityUpdate
) -> RegisteredAgentOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    if data.endpoint is not None:
        ra.endpoint = data.endpoint
    if data.credentials:
        ra.credential_type = data.credentials.type
        if data.credentials.api_key:
            ra.api_key = data.credentials.api_key
            ra.credential_ciphertext = data.credentials.api_key
            ra.credential_hint = _mask_hint(data.credentials.api_key)
    # Connectivity changes force re-validation.
    ra.capability_freshness = "needs_refresh"
    ra.preflight_status = "never_run"
    ra.preflight_run_at = None
    ra.status = "inactive"
    ra.is_active = False
    ra.updated_at = _now()
    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def activate_agent(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, data: ActivateAgentRequest
) -> RegisteredAgentOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    if ra.status == "archived":
        raise HTTPException(status_code=400, detail="Archived agent cannot be activated")
    if ra.preflight_status == "fail":
        raise HTTPException(status_code=400, detail="Preflight failed; cannot activate")
    if ra.preflight_status == "warning" and not data.allow_warning:
        raise HTTPException(status_code=400, detail="Preflight warning; set allow_warning to activate")
    if ra.preflight_status in ("never_run", "running") and ra.provider == "openclaw":
        raise HTTPException(status_code=400, detail="Preflight required before activation")
    ra.status = "active"
    ra.is_active = True
    ra.updated_at = _now()
    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def deactivate_agent(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, data: DeactivateAgentRequest
) -> RegisteredAgentOut:
    _ = data
    ra = await _get_agent_row(db, workspace_id, agent_id)
    ra.status = "inactive"
    ra.is_active = False
    ra.updated_at = _now()
    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def archive_agent(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, data: ArchiveAgentRequest
) -> RegisteredAgentOut:
    _ = data
    ra = await _get_agent_row(db, workspace_id, agent_id)
    ra.status = "archived"
    ra.is_active = False
    ra.archived_at = _now()
    ra.updated_at = _now()
    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def delete_agent(db: AsyncSession, workspace_id: UUID, agent_id: UUID) -> None:
    ra = await db.get(RegisteredAgent, agent_id)
    if ra is None or ra.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    # Soft-delete: mark archived so node refs aren't immediately broken
    ra.status = "archived"
    ra.is_active = False
    ra.archived_at = _now()
    ra.updated_at = _now()
    await db.commit()

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.deps import require_owner
from knotwork.database import get_db
from knotwork.workspaces.models import WorkspaceMember
from knotwork.openclaw_integrations import schemas, service

router = APIRouter(tags=["openclaw_integrations"])
plugin_router = APIRouter(tags=["openclaw_integrations"])


@router.post(
    "/workspaces/{workspace_id}/openclaw/handshake-token",
    response_model=schemas.HandshakeTokenOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_handshake_token(
    workspace_id: UUID,
    data: schemas.HandshakeTokenCreateRequest,
    db: AsyncSession = Depends(get_db),
    _member: WorkspaceMember = Depends(require_owner),
):
    return await service.create_handshake_token(db, workspace_id, data)


@router.get(
    "/workspaces/{workspace_id}/openclaw/integrations",
    response_model=list[schemas.OpenClawIntegrationOut],
)
async def list_integrations(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_integrations(db, workspace_id)


@router.delete(
    "/workspaces/{workspace_id}/openclaw/integrations/{integration_id}",
    response_model=schemas.OpenClawIntegrationDeleteOut,
)
async def delete_integration(
    workspace_id: UUID,
    integration_id: UUID,
    db: AsyncSession = Depends(get_db),
    _member: WorkspaceMember = Depends(require_owner),
):
    return await service.delete_integration(db, workspace_id, integration_id)


@router.get(
    "/workspaces/{workspace_id}/openclaw/debug-state",
    response_model=schemas.OpenClawDebugStateOut,
)
async def get_debug_state(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.get_debug_state(db, workspace_id)


@router.get(
    "/workspaces/{workspace_id}/openclaw/integrations/{integration_id}/agents",
    response_model=list[schemas.OpenClawRemoteAgentOut],
)
async def list_remote_agents(
    workspace_id: UUID,
    integration_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_remote_agents(db, workspace_id, integration_id)


@router.post(
    "/workspaces/{workspace_id}/openclaw/register-agent",
    response_model=schemas.RegisterFromOpenClawResponse,
)
async def register_openclaw_agent(
    workspace_id: UUID,
    data: schemas.RegisterFromOpenClawRequest,
    db: AsyncSession = Depends(get_db),
):
    return await service.register_from_remote_agent(db, workspace_id, data)


# Plugin callback endpoint (no /api/v1 prefix in main.py)
@plugin_router.post(
    "/openclaw-plugin/handshake",
    response_model=schemas.PluginHandshakeResponse,
)
async def plugin_handshake(
    data: schemas.PluginHandshakeRequest,
    db: AsyncSession = Depends(get_db),
):
    return await service.plugin_handshake(db, data)


@plugin_router.post("/openclaw-plugin/pull-task")
async def plugin_pull_task(
    data: schemas.PluginPullTaskRequest,
    db: AsyncSession = Depends(get_db),
    x_knotwork_integration_secret: str | None = Header(default=None),
):
    if not x_knotwork_integration_secret:
        return {"task": None}
    return await service.plugin_pull_task(
        db,
        plugin_instance_id=data.plugin_instance_id,
        integration_secret=x_knotwork_integration_secret,
        tasks_running=data.tasks_running,
        slots_available=data.slots_available,
    )


@plugin_router.post("/openclaw-plugin/tasks/{task_id}/event")
async def plugin_submit_task_event(
    task_id: UUID,
    data: schemas.PluginTaskEventRequest,
    db: AsyncSession = Depends(get_db),
    x_knotwork_integration_secret: str | None = Header(default=None),
):
    if not x_knotwork_integration_secret:
        return {"ok": False, "error": "missing integration secret"}
    return await service.plugin_submit_task_event(
        db,
        task_id=task_id,
        plugin_instance_id=data.plugin_instance_id,
        integration_secret=x_knotwork_integration_secret,
        event_type=data.event_type,
        payload=data.payload or {},
    )

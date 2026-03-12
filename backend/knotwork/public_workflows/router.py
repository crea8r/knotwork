from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.deps import get_current_user, require_owner
from knotwork.auth.models import User
from knotwork.database import get_db
from knotwork.public_workflows.schemas import (
    PublicRunNotifyOut,
    PublicRunNotifyRequest,
    PublicRunTriggerOut,
    PublicRunTriggerRequest,
    PublicRunViewOut,
    PublicWorkflowLinkCreateRequest,
    PublicWorkflowLinkOut,
    PublicWorkflowLinkUpdateRequest,
    PublicWorkflowViewOut,
)
from knotwork.public_workflows import service
from knotwork.workspaces.models import WorkspaceMember

router = APIRouter(tags=["public-workflows"])


def _map_storage_error(exc: Exception) -> None:
    message = str(exc).lower()
    # Most common deployment issue for this feature: migration not applied.
    if "public_workflow_links" in message or "public_run_shares" in message or "does not exist" in message:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=500,
            detail="Public link storage is not initialized. Run `alembic upgrade head` and restart backend.",
        )


@router.post(
    "/workspaces/{workspace_id}/graphs/{graph_id}/public-links",
    response_model=PublicWorkflowLinkOut,
    status_code=201,
)
async def create_public_link(
    workspace_id: UUID,
    graph_id: UUID,
    body: PublicWorkflowLinkCreateRequest,
    _member: WorkspaceMember = Depends(require_owner),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PublicWorkflowLinkOut:
    try:
        row = await service.create_public_link(
            db=db,
            workspace_id=workspace_id,
            graph_id=graph_id,
            graph_version_id=body.graph_version_id,
            description_md=body.description_md,
            created_by=user.id,
        )
    except (OperationalError, ProgrammingError) as exc:
        _map_storage_error(exc)
        raise
    return PublicWorkflowLinkOut.model_validate(row)


@router.get(
    "/workspaces/{workspace_id}/graphs/{graph_id}/public-links",
    response_model=list[PublicWorkflowLinkOut],
)
async def list_public_links(
    workspace_id: UUID,
    graph_id: UUID,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> list[PublicWorkflowLinkOut]:
    try:
        rows = await service.list_public_links(db, workspace_id, graph_id)
    except (OperationalError, ProgrammingError) as exc:
        _map_storage_error(exc)
        raise
    return [PublicWorkflowLinkOut.model_validate(row) for row in rows]


@router.patch(
    "/workspaces/{workspace_id}/graphs/{graph_id}/public-links/{link_id}",
    response_model=PublicWorkflowLinkOut,
)
async def update_public_link(
    workspace_id: UUID,
    graph_id: UUID,
    link_id: UUID,
    body: PublicWorkflowLinkUpdateRequest,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> PublicWorkflowLinkOut:
    try:
        row = await service.update_public_link(
            db=db,
            workspace_id=workspace_id,
            graph_id=graph_id,
            link_id=link_id,
            graph_version_id=body.graph_version_id,
            description_md=body.description_md,
        )
    except (OperationalError, ProgrammingError) as exc:
        _map_storage_error(exc)
        raise
    return PublicWorkflowLinkOut.model_validate(row)


@router.post(
    "/workspaces/{workspace_id}/graphs/{graph_id}/public-links/{link_id}/disable",
    response_model=PublicWorkflowLinkOut,
)
async def disable_public_link(
    workspace_id: UUID,
    graph_id: UUID,
    link_id: UUID,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> PublicWorkflowLinkOut:
    try:
        row = await service.disable_public_link(
            db=db,
            workspace_id=workspace_id,
            graph_id=graph_id,
            link_id=link_id,
        )
    except (OperationalError, ProgrammingError) as exc:
        _map_storage_error(exc)
        raise
    return PublicWorkflowLinkOut.model_validate(row)


public_router = APIRouter(prefix="/public", tags=["public-workflows"])


@public_router.get("/workflows/{token}", response_model=PublicWorkflowViewOut)
async def get_public_workflow(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> PublicWorkflowViewOut:
    link, version = await service.get_public_workflow_view(db, token)
    definition = version.definition if isinstance(version.definition, dict) else {}
    input_schema = definition.get("input_schema", []) if isinstance(definition, dict) else []
    limit_count, limit_window = service.rate_limit_meta()
    return PublicWorkflowViewOut(
        description_md=link.description_md,
        input_schema=input_schema if isinstance(input_schema, list) else [],
        rate_limit_max_requests=limit_count,
        rate_limit_window_seconds=limit_window,
    )


@public_router.post("/workflows/{token}/trigger", response_model=PublicRunTriggerOut, status_code=201)
async def trigger_public_workflow_run(
    token: str,
    body: PublicRunTriggerRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PublicRunTriggerOut:
    share = await service.trigger_public_run(
        db=db,
        token=token,
        input_payload=body.input,
        email=body.email,
        client_ip=service.client_ip_from_headers(
            request.headers.get("x-forwarded-for"),
            request.client.host if request.client else None,
        ),
    )
    return PublicRunTriggerOut(
        run_id=share.run_id,
        run_token=share.token,
        run_public_url=f"/public/runs/{share.token}",
    )


@public_router.get("/runs/{token}", response_model=PublicRunViewOut)
async def get_public_run(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> PublicRunViewOut:
    share, run, final_output = await service.get_public_run_view(db, token)
    return PublicRunViewOut(
        description_md=share.description_md,
        input=run.input or {},
        final_output=final_output,
        status="completed" if final_output else "processing",
        email_subscribed=bool((share.email or "").strip()),
    )


@public_router.post("/runs/{token}/notify", response_model=PublicRunNotifyOut)
async def subscribe_public_run_completion_email(
    token: str,
    body: PublicRunNotifyRequest,
    db: AsyncSession = Depends(get_db),
) -> PublicRunNotifyOut:
    await service.set_public_run_email(db, token, body.email)
    return PublicRunNotifyOut(ok=True)

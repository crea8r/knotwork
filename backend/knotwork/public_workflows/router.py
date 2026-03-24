from __future__ import annotations

import base64
import hashlib
import hmac
import mimetypes
from pathlib import Path
from uuid import UUID
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.deps import get_current_user, require_owner
from knotwork.auth.models import User
from knotwork.config import settings
from knotwork.database import get_db
from knotwork.knowledge.storage import get_storage_adapter
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
from knotwork.runs.schemas import RunAttachmentUploadOut
from knotwork.workspaces.models import WorkspaceMember

router = APIRouter(tags=["public-workflows"])
MAX_RUN_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024


def _map_storage_error(exc: Exception) -> None:
    message = str(exc).lower()
    # Most common deployment issue for this feature: migration not applied.
    if "public_workflow_links" in message or "public_run_shares" in message or "does not exist" in message:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=500,
            detail="Public link storage is not initialized. Run `alembic upgrade head` and restart backend.",
        )


def _safe_filename(name: str) -> str:
    cleaned = Path(name or "attachment").name
    return cleaned or "attachment"


def _build_attachment_key(workspace_id: UUID, attachment_id: str, filename: str) -> str:
    return f"runs/{workspace_id}/{attachment_id}/{filename}"


def _build_download_token(workspace_id: UUID, key: str) -> str:
    msg = f"{workspace_id}:{key}".encode("utf-8")
    return hmac.new(settings.jwt_secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


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


@public_router.post(
    "/workflows/{token}/attachments",
    response_model=RunAttachmentUploadOut,
    status_code=201,
)
async def upload_public_workflow_attachment(
    token: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> RunAttachmentUploadOut:
    link, _version = await service.get_public_workflow_view(db, token)
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_RUN_ATTACHMENT_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large — max 10 MB")

    filename = _safe_filename(file.filename or "attachment")
    mime_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    attachment_id = uuid4().hex
    key = _build_attachment_key(link.workspace_id, attachment_id, filename)
    encoded = base64.b64encode(content).decode("ascii")
    await get_storage_adapter().write(
        workspace_id="_run_attachments",
        path=key,
        content=encoded,
        saved_by="public_run_attachment",
        change_summary=f"public run attachment {filename}",
    )
    token_value = _build_download_token(link.workspace_id, key)
    base = settings.normalized_backend_url
    url = f"{base}/api/v1/public/workflows/{token}/attachments/{attachment_id}/{filename}?download_token={token_value}"
    return RunAttachmentUploadOut(
        key=key,
        url=url,
        filename=filename,
        mime_type=mime_type,
        size=len(content),
        attachment_id=attachment_id,
    )


@public_router.get("/workflows/{token}/attachments/{attachment_id}/{filename}")
async def serve_public_workflow_attachment(
    token: str,
    attachment_id: str,
    filename: str,
    download_token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    link, _version = await service.get_public_workflow_view(db, token)
    safe_name = _safe_filename(filename)
    key = _build_attachment_key(link.workspace_id, attachment_id, safe_name)
    expected = _build_download_token(link.workspace_id, key)
    if not hmac.compare_digest(download_token, expected):
        raise HTTPException(status_code=403, detail="Invalid attachment token")

    try:
        file_content = await get_storage_adapter().read("_run_attachments", key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Attachment not found")

    raw_bytes = base64.b64decode(file_content.content)
    mime_type = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    return Response(
        content=raw_bytes,
        media_type=mime_type,
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
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
        context_files=[item.model_dump() for item in body.context_files],
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

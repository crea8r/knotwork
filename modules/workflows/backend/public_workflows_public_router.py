from __future__ import annotations

import base64
import mimetypes
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

import hmac

from libs.config import settings
from libs.database import get_db
from modules.assets.backend.storage import get_storage_adapter
from . import public_workflows_service as service
from .public_workflows_attachment_helpers import (
    MAX_RUN_ATTACHMENT_SIZE_BYTES,
    build_attachment_key,
    build_download_token,
    safe_filename,
)
from .public_workflows_schemas import (
    PublicRunNotifyOut,
    PublicRunNotifyRequest,
    PublicRunTriggerOut,
    PublicRunTriggerRequest,
    PublicRunViewOut,
    PublicWorkflowViewOut,
)
from .public_workflows_slugs import (
    resolve_default_version_by_graph_slug,
    resolve_version_by_slugs,
)
from .runs_schemas import RunAttachmentUploadOut

public_router = APIRouter(prefix="/public", tags=["public-workflows"])


def _workflow_view_out(version, description_md: str) -> PublicWorkflowViewOut:
    definition = version.definition if isinstance(version.definition, dict) else {}
    input_schema = definition.get("input_schema", []) if isinstance(definition, dict) else []
    limit_count, limit_window = service.rate_limit_meta()
    return PublicWorkflowViewOut(
        description_md=description_md,
        input_schema=input_schema if isinstance(input_schema, list) else [],
        rate_limit_max_requests=limit_count,
        rate_limit_window_seconds=limit_window,
        resolved_version_slug=version.version_slug or "",
    )


# ── Version-specific URL ─────────────────────────────────────────────────────

@public_router.get("/workflows/{graph_slug}/{version_slug}", response_model=PublicWorkflowViewOut)
async def get_public_workflow_by_version_slug(
    graph_slug: str, version_slug: str, db: AsyncSession = Depends(get_db),
) -> PublicWorkflowViewOut:
    _graph, version = await resolve_version_by_slugs(db, graph_slug, version_slug)
    return _workflow_view_out(version, version.public_description_md or "")


@public_router.post("/workflows/{graph_slug}/{version_slug}/trigger", response_model=PublicRunTriggerOut, status_code=201)
async def trigger_public_workflow_by_version_slug(
    graph_slug: str, version_slug: str,
    body: PublicRunTriggerRequest, request: Request, db: AsyncSession = Depends(get_db),
) -> PublicRunTriggerOut:
    graph, version = await resolve_version_by_slugs(db, graph_slug, version_slug)
    share = await service.trigger_public_run(
        db=db, graph=graph, version=version,
        input_payload=body.input, email=body.email,
        context_files=[item.model_dump() for item in body.context_files],
        rate_key=f"{graph_slug}/{version_slug}",
        client_ip=service.client_ip_from_headers(
            request.headers.get("x-forwarded-for"),
            request.client.host if request.client else None,
        ),
    )
    return PublicRunTriggerOut(run_id=share.run_id, run_token=share.token, run_public_url=f"/public/runs/{share.token}")


@public_router.post("/workflows/{graph_slug}/{version_slug}/attachments", response_model=RunAttachmentUploadOut, status_code=201)
async def upload_attachment_by_version_slug(
    graph_slug: str, version_slug: str,
    file: UploadFile = File(...), db: AsyncSession = Depends(get_db),
) -> RunAttachmentUploadOut:
    graph, _version = await resolve_version_by_slugs(db, graph_slug, version_slug)
    return await _do_upload(graph.workspace_id, f"{graph_slug}/{version_slug}", file)


@public_router.get("/workflows/{graph_slug}/{version_slug}/attachments/{attachment_id}/{filename}")
async def serve_attachment_by_version_slug(
    graph_slug: str, version_slug: str, attachment_id: str, filename: str,
    download_token: str = Query(...), db: AsyncSession = Depends(get_db),
):
    graph, _version = await resolve_version_by_slugs(db, graph_slug, version_slug)
    return await _do_serve(graph.workspace_id, attachment_id, filename, download_token)


# ── Graph-level URL (proxies to default version) ─────────────────────────────

@public_router.get("/workflows/{graph_slug}", response_model=PublicWorkflowViewOut)
async def get_public_workflow_by_graph_slug(
    graph_slug: str, db: AsyncSession = Depends(get_db),
) -> PublicWorkflowViewOut:
    _graph, version = await resolve_default_version_by_graph_slug(db, graph_slug)
    return _workflow_view_out(version, version.public_description_md or "")


@public_router.post("/workflows/{graph_slug}/trigger", response_model=PublicRunTriggerOut, status_code=201)
async def trigger_public_workflow_by_graph_slug(
    graph_slug: str,
    body: PublicRunTriggerRequest, request: Request, db: AsyncSession = Depends(get_db),
) -> PublicRunTriggerOut:
    graph, version = await resolve_default_version_by_graph_slug(db, graph_slug)
    share = await service.trigger_public_run(
        db=db, graph=graph, version=version,
        input_payload=body.input, email=body.email,
        context_files=[item.model_dump() for item in body.context_files],
        rate_key=graph_slug,
        client_ip=service.client_ip_from_headers(
            request.headers.get("x-forwarded-for"),
            request.client.host if request.client else None,
        ),
    )
    return PublicRunTriggerOut(run_id=share.run_id, run_token=share.token, run_public_url=f"/public/runs/{share.token}")


# ── Run result ────────────────────────────────────────────────────────────────

@public_router.get("/runs/{token}", response_model=PublicRunViewOut)
async def get_public_run(token: str, db: AsyncSession = Depends(get_db)) -> PublicRunViewOut:
    share, run, final_output = await service.get_public_run_view(db, token)
    return PublicRunViewOut(
        description_md=share.description_md, input=run.input or {},
        final_output=final_output, status="completed" if final_output else "processing",
        email_subscribed=bool((share.email or "").strip()),
    )


@public_router.post("/runs/{token}/notify", response_model=PublicRunNotifyOut)
async def subscribe_public_run_completion_email(
    token: str, body: PublicRunNotifyRequest, db: AsyncSession = Depends(get_db),
) -> PublicRunNotifyOut:
    await service.set_public_run_email(db, token, body.email)
    return PublicRunNotifyOut(ok=True)


# ── Shared attachment helpers ─────────────────────────────────────────────────

async def _do_upload(workspace_id, slug_path: str, file: UploadFile) -> RunAttachmentUploadOut:
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_RUN_ATTACHMENT_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large — max 10 MB")
    filename = safe_filename(file.filename or "attachment")
    mime_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    attachment_id = uuid4().hex
    key = build_attachment_key(workspace_id, attachment_id, filename)
    encoded = base64.b64encode(content).decode("ascii")
    await get_storage_adapter().write(
        workspace_id="_run_attachments", path=key, content=encoded,
        saved_by="public_run_attachment", change_summary=f"public run attachment {filename}",
    )
    token_value = build_download_token(workspace_id, key)
    base = settings.normalized_backend_url
    url = f"{base}/api/v1/public/workflows/{slug_path}/attachments/{attachment_id}/{filename}?download_token={token_value}"
    return RunAttachmentUploadOut(key=key, url=url, filename=filename, mime_type=mime_type, size=len(content), attachment_id=attachment_id)


async def _do_serve(workspace_id, attachment_id: str, filename: str, download_token: str) -> Response:
    safe_name = safe_filename(filename)
    key = build_attachment_key(workspace_id, attachment_id, safe_name)
    expected = build_download_token(workspace_id, key)
    if not hmac.compare_digest(download_token, expected):
        raise HTTPException(status_code=403, detail="Invalid attachment token")
    try:
        file_content = await get_storage_adapter().read("_run_attachments", key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Attachment not found")
    raw_bytes = base64.b64decode(file_content.content)
    mime_type = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    return Response(content=raw_bytes, media_type=mime_type, headers={"Content-Disposition": f'inline; filename="{safe_name}"'})

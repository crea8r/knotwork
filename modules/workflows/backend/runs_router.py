import base64
import hashlib
import hmac
import mimetypes
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Path as PathParam, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from libs.config import settings
from libs.database import get_db
from modules.assets.backend.storage import get_storage_adapter
from modules.communication.backend.channels_schemas import ChannelMessageOut

from . import runs_service as service
from .runs_schemas import (
    OpenAICallLogOut, ResumeRun, RunCreate, RunHandbookProposalOut, RunNodeStateOut, RunOut,
    RunAttachmentUploadOut, RunUpdate, RunWorklogEntryOut,
)


router = APIRouter(prefix="/workspaces", tags=["runs"])
MAX_RUN_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024


def _build_download_token(workspace_id: UUID, key: str) -> str:
    msg = f"{workspace_id}:{key}".encode("utf-8")
    return hmac.new(settings.jwt_secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _safe_filename(name: str) -> str:
    # Keep only the final path segment so uploads cannot escape storage prefixes.
    cleaned = Path(name or "attachment").name
    return cleaned or "attachment"


def _build_attachment_key(workspace_id: UUID, attachment_id: str, filename: str) -> str:
    return f"runs/{workspace_id}/{attachment_id}/{filename}"


@router.post("/{workspace_id}/graphs/{graph_id}/runs", response_model=RunOut, status_code=201)
async def trigger_run(
    workspace_id: UUID,
    graph_id: UUID,
    data: RunCreate,
    db: AsyncSession = Depends(get_db),
):
    try:
        run = await service.create_run(db, workspace_id, graph_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return RunOut.model_validate(run)


@router.post(
    "/{workspace_id}/runs/attachments",
    response_model=RunAttachmentUploadOut,
    status_code=201,
)
async def upload_run_attachment(
    workspace_id: UUID,
    request: Request,
    file: UploadFile = File(...),
):
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_RUN_ATTACHMENT_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large — max 10 MB")

    filename = _safe_filename(file.filename or "attachment")
    mime_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    attachment_id = uuid4().hex
    key = _build_attachment_key(workspace_id, attachment_id, filename)
    encoded = base64.b64encode(content).decode("ascii")
    await get_storage_adapter().write(
        workspace_id="_run_attachments",
        path=key,
        content=encoded,
        saved_by="run_attachment",
        change_summary=f"run attachment {filename}",
    )
    token = _build_download_token(workspace_id, key)
    base = settings.normalized_backend_url
    url = f"{base}/api/v1/workspaces/{workspace_id}/runs/attachments/{attachment_id}/{filename}?token={token}"
    return RunAttachmentUploadOut(
        key=key,
        url=url,
        filename=filename,
        mime_type=mime_type,
        size=len(content),
        attachment_id=attachment_id,
    )


@router.get("/{workspace_id}/runs/attachments/{attachment_id}/{filename}")
async def serve_run_attachment(
    workspace_id: UUID,
    attachment_id: str,
    filename: str,
    token: str = Query(...),
):
    safe_name = _safe_filename(filename)
    key = _build_attachment_key(workspace_id, attachment_id, safe_name)
    expected = _build_download_token(workspace_id, key)
    if not hmac.compare_digest(token, expected):
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


@router.get("/{workspace_id}/runs", response_model=list[RunOut])
async def list_workspace_runs(workspace_id: UUID, db: AsyncSession = Depends(get_db)):
    rows = await service.list_workspace_runs(db, workspace_id)
    return [RunOut.model_validate(r) for r in rows]


@router.get("/{workspace_id}/runs/{run_id}", response_model=RunOut)
async def get_run(workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    return RunOut.model_validate(run)


@router.patch("/{workspace_id}/runs/{run_id}", response_model=RunOut)
async def update_run(
    workspace_id: UUID,
    data: RunUpdate,
    run_id: str = PathParam(..., min_length=8, max_length=36),
    db: AsyncSession = Depends(get_db),
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    try:
        updated = await service.update_run(db, run_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return RunOut.model_validate(updated)


@router.get("/{workspace_id}/runs/{run_id}/nodes", response_model=list[RunNodeStateOut])
async def list_run_nodes(
    workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    nodes = await service.list_run_node_states(db, run_id)
    return [RunNodeStateOut.model_validate(n) for n in nodes]


@router.post("/{workspace_id}/runs/{run_id}/resume")
async def resume_run(
    workspace_id: UUID,
    data: ResumeRun,
    run_id: str = PathParam(..., min_length=8, max_length=36),
    db: AsyncSession = Depends(get_db),
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    if run.status != "paused":
        raise HTTPException(400, f"Run is not paused (status: {run.status})")
    import asyncio
    enqueued = False
    try:
        from arq import create_pool
        from arq.connections import RedisSettings
        from libs.config import settings

        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        try:
            await redis.enqueue_job("resume_run", run_id=str(run_id), resolution=data.model_dump())
            enqueued = True
        finally:
            await redis.aclose()
    except Exception:
        # Fall back to in-process resume in dev/unhealthy queue situations.
        from .runtime.runner import resume_run as _resume_run
        asyncio.create_task(_resume_run(str(run_id), data.model_dump()))
        return {"status": "resuming", "run_id": str(run_id)}

    if enqueued:
        asyncio.create_task(_resume_if_still_paused(str(run_id), data.model_dump(), delay_seconds=3.0))

    return {"status": "resuming", "run_id": str(run_id)}


@router.post("/{workspace_id}/runs/{run_id}/abort", status_code=200)
async def abort_run(
    workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)
):
    from datetime import datetime, timezone
    from .runtime.events import publish_event
    from .public_workflows_service import notify_public_run_aborted
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    if run.status in ("completed", "failed", "stopped"):
        raise HTTPException(400, f"Run already in terminal state: {run.status}")
    run.status = "stopped"
    run.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await notify_public_run_aborted(db, run_id)
    await publish_event(str(run_id), {"type": "run_status_changed", "status": "stopped"})
    return {"status": "stopped", "run_id": str(run_id)}


@router.delete("/{workspace_id}/runs/{run_id}", status_code=204)
async def delete_run(
    workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    if run.status not in service.DELETABLE_STATUSES:
        raise HTTPException(400, f"Cannot delete a run with status '{run.status}'")
    await service.delete_run(db, run_id)


@router.post("/{workspace_id}/runs/{run_id}/execute", status_code=200)
async def execute_run_inline(
    workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)
):
    """Execute a queued/draft run immediately (dev helper — no worker needed)."""
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    if run.status not in ("queued", "draft"):
        raise HTTPException(400, f"Run must be queued or draft (status: {run.status})")
    import asyncio
    from .runtime.engine import execute_run as _execute_run
    asyncio.create_task(_execute_run(str(run_id)))
    return {"status": "executing", "run_id": str(run_id)}


@router.post("/{workspace_id}/runs/{run_id}/clone", response_model=RunOut, status_code=201)
async def clone_run(
    workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    try:
        draft = await service.clone_run_as_draft(db, run_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return RunOut.model_validate(draft)


@router.get("/{workspace_id}/graphs/{graph_id}/runs", response_model=list[RunOut])
async def list_graph_runs(
    workspace_id: UUID, graph_id: UUID, db: AsyncSession = Depends(get_db)
):
    rows = await service.list_workspace_runs(db, workspace_id)
    return [RunOut.model_validate(r) for r in rows if str(r["graph_id"]) == str(graph_id)]


@router.get("/{workspace_id}/runs/{run_id}/worklog", response_model=list[RunWorklogEntryOut])
async def get_run_worklog(
    workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    entries = await service.list_worklog(db, run_id)
    return [RunWorklogEntryOut.model_validate(e) for e in entries]


@router.get(
    "/{workspace_id}/runs/{run_id}/handbook-proposals",
    response_model=list[RunHandbookProposalOut],
)
async def get_run_proposals(
    workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    proposals = await service.list_proposals(db, run_id)
    return [RunHandbookProposalOut.model_validate(p) for p in proposals]


@router.get("/{workspace_id}/runs/{run_id}/openai-logs", response_model=list[OpenAICallLogOut])
async def get_run_openai_logs(
    workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    logs = await service.list_openai_logs(db, run_id)
    return [OpenAICallLogOut.model_validate(row) for row in logs]


@router.get("/{workspace_id}/runs/{run_id}/chat-messages", response_model=list[ChannelMessageOut])
async def get_run_chat_messages(
    workspace_id: UUID, run_id: str = PathParam(..., min_length=8, max_length=36), db: AsyncSession = Depends(get_db)
):
    run = await service.get_run(db, run_id)
    if not run or run.workspace_id != workspace_id:
        raise HTTPException(404, "Run not found")
    rows = await service.list_run_chat_messages(db, run_id)
    return [ChannelMessageOut.model_validate(row) for row in rows]


async def _resume_if_still_paused(run_id: str, resolution: dict, delay_seconds: float = 3.0) -> None:
    import asyncio
    from sqlalchemy import select
    from libs.database import AsyncSessionLocal
    from modules.communication.backend.escalations_models import Escalation
    from .runs_models import Run
    from .runtime.runner import resume_run as _resume_run

    await asyncio.sleep(delay_seconds)
    async with AsyncSessionLocal() as db:
        run = await db.get(Run, run_id)
        if not run or run.status != "paused":
            return
        # Avoid duplicate resumes when the first resume already created
        # a fresh open escalation and the run is intentionally paused.
        open_esc = await db.execute(
            select(Escalation.id).where(
                Escalation.run_id == run_id,
                Escalation.status == "open",
            )
        )
        if open_esc.first() is not None:
            return
    await _resume_run(run_id, resolution)

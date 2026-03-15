"""HTTP layer for registered_agents."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels.schemas import ChannelMessageOut
from knotwork.config import settings
from knotwork.database import get_db
from knotwork.registered_agents import schemas, service

router = APIRouter(tags=["registered_agents"])


@router.get(
    "/workspaces/{workspace_id}/agents",
    response_model=list[schemas.RegisteredAgentOut],
)
async def list_agents(
    workspace_id: UUID,
    q: str | None = None,
    provider: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    preflight_status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_agents(
        db,
        workspace_id,
        q=q,
        provider=provider,
        status_filter=status_filter,
        preflight_status=preflight_status,
    )


@router.post(
    "/workspaces/{workspace_id}/agents",
    response_model=schemas.RegisteredAgentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_agent(
    workspace_id: UUID,
    data: schemas.RegisteredAgentCreate,
    db: AsyncSession = Depends(get_db),
):
    return await service.create_agent(db, workspace_id, data)


@router.get(
    "/workspaces/{workspace_id}/agents/{agent_id}",
    response_model=schemas.RegisteredAgentOut,
)
async def get_agent(
    workspace_id: UUID,
    agent_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.get_agent(db, workspace_id, agent_id)


@router.patch(
    "/workspaces/{workspace_id}/agents/{agent_id}",
    response_model=schemas.RegisteredAgentOut,
)
async def update_agent(
    workspace_id: UUID,
    agent_id: UUID,
    data: schemas.RegisteredAgentUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await service.update_agent(db, workspace_id, agent_id, data)


@router.patch(
    "/workspaces/{workspace_id}/agents/{agent_id}/connectivity",
    response_model=schemas.RegisteredAgentOut,
)
async def update_connectivity(
    workspace_id: UUID,
    agent_id: UUID,
    data: schemas.AgentConnectivityUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await service.update_connectivity(db, workspace_id, agent_id, data)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/activate",
    response_model=schemas.RegisteredAgentOut,
)
async def activate_agent(
    workspace_id: UUID,
    agent_id: UUID,
    data: schemas.ActivateAgentRequest,
    db: AsyncSession = Depends(get_db),
):
    return await service.activate_agent(db, workspace_id, agent_id, data)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/deactivate",
    response_model=schemas.RegisteredAgentOut,
)
async def deactivate_agent(
    workspace_id: UUID,
    agent_id: UUID,
    data: schemas.DeactivateAgentRequest,
    db: AsyncSession = Depends(get_db),
):
    return await service.deactivate_agent(db, workspace_id, agent_id, data)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/archive",
    response_model=schemas.RegisteredAgentOut,
)
async def archive_agent(
    workspace_id: UUID,
    agent_id: UUID,
    data: schemas.ArchiveAgentRequest,
    db: AsyncSession = Depends(get_db),
):
    return await service.archive_agent(db, workspace_id, agent_id, data)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/capabilities/refresh",
    response_model=schemas.CapabilityRefreshOut,
)
async def refresh_capabilities(
    workspace_id: UUID,
    agent_id: UUID,
    data: schemas.CapabilityRefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    return await service.refresh_capabilities(db, workspace_id, agent_id, data)


@router.get(
    "/workspaces/{workspace_id}/agents/{agent_id}/capabilities/latest",
    response_model=schemas.CapabilityContractOut,
)
async def get_latest_capability(
    workspace_id: UUID,
    agent_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.get_latest_capability(db, workspace_id, agent_id)


@router.get(
    "/workspaces/{workspace_id}/agents/{agent_id}/capabilities",
    response_model=list[schemas.CapabilitySnapshotOut],
)
async def list_capabilities(
    workspace_id: UUID,
    agent_id: UUID,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_capabilities(db, workspace_id, agent_id, limit=limit)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/preflight-runs",
    response_model=schemas.PreflightRunDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def run_preflight(
    workspace_id: UUID,
    agent_id: UUID,
    data: schemas.PreflightRunRequest,
    db: AsyncSession = Depends(get_db),
):
    return await service.run_preflight(db, workspace_id, agent_id, data)


@router.get(
    "/workspaces/{workspace_id}/agents/{agent_id}/preflight-runs",
    response_model=list[schemas.PreflightRunOut],
)
async def list_preflight_runs(
    workspace_id: UUID,
    agent_id: UUID,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_preflight_runs(db, workspace_id, agent_id, limit=limit)


@router.get(
    "/workspaces/{workspace_id}/agents/{agent_id}/preflight-runs/{preflight_run_id}",
    response_model=schemas.PreflightRunDetailOut,
)
async def get_preflight_run(
    workspace_id: UUID,
    agent_id: UUID,
    preflight_run_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.get_preflight_run(db, workspace_id, agent_id, preflight_run_id)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/preflight-runs/{preflight_run_id}/promote-baseline",
    response_model=schemas.PreflightRunOut,
)
async def promote_baseline(
    workspace_id: UUID,
    agent_id: UUID,
    preflight_run_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.promote_preflight_baseline(db, workspace_id, agent_id, preflight_run_id)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/compatibility-check",
    response_model=schemas.CompatibilityCheckOut,
)
async def compatibility_check(
    workspace_id: UUID,
    agent_id: UUID,
    data: schemas.CompatibilityCheckRequest,
    db: AsyncSession = Depends(get_db),
):
    return await service.compatibility_check(db, workspace_id, agent_id, data)


@router.get(
    "/workspaces/{workspace_id}/agents/{agent_id}/usage",
    response_model=list[schemas.AgentUsageItem],
)
async def get_agent_usage(
    workspace_id: UUID,
    agent_id: UUID,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_usage(db, workspace_id, agent_id, limit=limit)


@router.get(
    "/workspaces/{workspace_id}/agents/{agent_id}/debug-links",
    response_model=list[schemas.DebugLinkItem],
)
async def get_debug_links(
    workspace_id: UUID,
    agent_id: UUID,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    return await service.get_debug_links(db, workspace_id, agent_id, limit=limit)


@router.get(
    "/workspaces/{workspace_id}/agents/{agent_id}/history",
    response_model=list[schemas.RegisteredAgentHistoryItem],
)
async def get_agent_history(
    workspace_id: UUID,
    agent_id: UUID,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_agent_history(db, workspace_id, agent_id, limit=limit)


@router.delete(
    "/workspaces/{workspace_id}/agents/{agent_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_agent(
    workspace_id: UUID,
    agent_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    await service.delete_agent(db, workspace_id, agent_id)


@router.get(
    "/workspaces/{workspace_id}/agents/{agent_id}/main-chat/messages",
    response_model=list[ChannelMessageOut],
)
async def list_main_chat_messages(
    workspace_id: UUID,
    agent_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.list_main_chat_messages(db, workspace_id, agent_id)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/main-chat/ensure",
    response_model=schemas.AgentMainChatEnsureResponse,
)
async def ensure_main_chat(
    workspace_id: UUID,
    agent_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await service.ensure_main_chat_ready(db, workspace_id, agent_id)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/main-chat/ask",
    response_model=schemas.AgentMainChatAskResponse,
)
async def ask_main_chat(
    workspace_id: UUID,
    agent_id: UUID,
    data: schemas.AgentMainChatAskRequest,
    db: AsyncSession = Depends(get_db),
):
    return await service.ask_main_chat(db, workspace_id, agent_id, data)


@router.post(
    "/workspaces/{workspace_id}/agents/{agent_id}/main-chat/attach",
)
async def upload_chat_attachment(
    workspace_id: UUID,
    agent_id: UUID,
    file: UploadFile = File(...),
    request: Request = None,
):
    """Store a raw file and return a URL that OpenClaw can fetch.

    Knotwork does zero processing — bytes are base64-stored via StorageAdapter.
    OpenClaw receives the URL in task.attachments and handles the file itself.
    """
    import base64
    import mimetypes
    from uuid import uuid4 as _uuid4
    from knotwork.knowledge.storage import get_storage_adapter

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large — max 50 MB")

    filename = file.filename or "attachment"
    mime_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    attachment_id = str(_uuid4())
    storage_path = f"{attachment_id}/{filename}"

    # Store binary file as base64 text via StorageAdapter (workspace = "_chat_attachments")
    adapter = get_storage_adapter()
    encoded = base64.b64encode(content).decode("ascii")
    await adapter.write(
        workspace_id="_chat_attachments",
        path=storage_path,
        content=encoded,
        saved_by="chat_attach",
        change_summary=f"chat attachment {filename}",
    )

    base = settings.normalized_backend_base_url
    download_url = f"{base}/api/v1/chat-attachments/{attachment_id}/{filename}"

    return {
        "key": storage_path,
        "url": download_url,
        "filename": filename,
        "mime_type": mime_type,
        "size": len(content),
        "attachment_id": attachment_id,
    }


@router.get("/chat-attachments/{attachment_id}/{filename}")
async def serve_chat_attachment(attachment_id: str, filename: str):
    """Serve a raw chat attachment. Called by the OpenClaw plugin to fetch file bytes."""
    import base64
    import mimetypes
    from fastapi.responses import Response
    from knotwork.knowledge.storage import get_storage_adapter

    storage_path = f"{attachment_id}/{filename}"
    adapter = get_storage_adapter()
    try:
        file_content = await adapter.read("_chat_attachments", storage_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Attachment not found")

    raw_bytes = base64.b64decode(file_content.content)
    mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return Response(
        content=raw_bytes,
        media_type=mime_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )

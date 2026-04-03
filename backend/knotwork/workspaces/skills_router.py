"""
GET /workspaces/{workspace_id}/skills

Returns the skills.md document for the requesting participant.
Used by agents on startup to bootstrap workspace context.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.deps import get_current_user, get_workspace_member
from knotwork.auth.models import User
from knotwork.channels import service as csvc
from knotwork.config import settings
from knotwork.database import get_db
from knotwork.knowledge import service as ksvc
from knotwork.workspaces.models import Workspace, WorkspaceMember
from knotwork.workspaces.skills import generate_skills_md

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("/{workspace_id}/skills")
async def get_workspace_skills(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """
    Return the skills.md document for this workspace.

    The document is personalised to the calling participant (their name and
    role are embedded). Agents fetch this on startup to bootstrap context;
    humans can fetch it too for reference.
    """
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    knowledge_files = await ksvc.list_files(db, workspace_id)
    channels = await csvc.list_channels(db, workspace_id)

    mcp_url = f"{settings.normalized_backend_url}/mcp"
    content = generate_skills_md(
        workspace_name=workspace.name,
        agent_name=current_user.name,
        agent_role=member.role,
        knowledge_files=knowledge_files,
        channels=channels,
        mcp_server_url=mcp_url,
        workspace_guide=workspace.guide_md,
    )
    return Response(content=content, media_type="text/markdown; charset=utf-8")

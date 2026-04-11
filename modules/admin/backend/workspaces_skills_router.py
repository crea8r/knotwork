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

from libs.config import settings
from core.api import channels as core_channels
from core.api import knowledge as core_knowledge
from libs.database import get_db
from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User
from .workspaces_models import Workspace, WorkspaceMember
from .workspaces_skills import generate_skills_md

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

    knowledge_files = await core_knowledge.list_files(db, workspace_id)
    channels = await core_channels.list_channels(db, workspace_id)

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

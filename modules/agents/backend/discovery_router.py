"""
GET /api/v1/workspaces/{workspace_id}/.well-known/agent

Unauthenticated discovery endpoint for agent harnesses. An agent with only a
backend URL and workspace ID can call this to learn how to authenticate, load
workspace bootstrap context, and connect to Knotwork MCP.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from libs.config import settings
from libs.database import get_db
from modules.admin.backend.workspaces_models import Workspace

router = APIRouter(prefix="/workspaces", tags=["agents"])


class AgentAuthInfo(BaseModel):
    challenge_endpoint: str
    token_endpoint: str
    key_type: str
    nonce_ttl_seconds: int
    token_lifetime_days: int


class AgentDiscovery(BaseModel):
    workspace_id: str
    workspace_name: str
    auth: AgentAuthInfo
    skills_endpoint: str
    mcp_server_url: str


@router.get("/{workspace_id}/.well-known/agent", response_model=AgentDiscovery)
async def agent_well_known(
    workspace_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> AgentDiscovery:
    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    base = settings.normalized_backend_url
    api = f"{base}/api/v1"

    return AgentDiscovery(
        workspace_id=str(workspace.id),
        workspace_name=workspace.name,
        auth=AgentAuthInfo(
            challenge_endpoint=f"POST {api}/auth/agent-challenge",
            token_endpoint=f"POST {api}/auth/agent-token",
            key_type="ed25519",
            nonce_ttl_seconds=120,
            token_lifetime_days=30,
        ),
        skills_endpoint=f"GET {api}/workspaces/{workspace_id}/skills",
        mcp_server_url=f"{base}/mcp",
    )

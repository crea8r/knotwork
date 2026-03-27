from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.deps import require_owner
from knotwork.database import get_db
from knotwork.graphs.schemas import GraphVersionOut
from knotwork.public_workflows.schemas import VersionPublishRequest
from knotwork.public_workflows import service
from knotwork.workspaces.models import WorkspaceMember

router = APIRouter(tags=["public-workflows"])


@router.post(
    "/workspaces/{workspace_id}/graphs/{graph_id}/versions/{version_id}/publish",
    response_model=GraphVersionOut,
)
async def publish_version(
    workspace_id: UUID,
    graph_id: UUID,
    version_id: UUID,
    body: VersionPublishRequest,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> GraphVersionOut:
    version = await service.publish_version(db, workspace_id, graph_id, version_id, body.description_md)
    return GraphVersionOut.model_validate(version)


@router.delete(
    "/workspaces/{workspace_id}/graphs/{graph_id}/versions/{version_id}/publish",
    response_model=GraphVersionOut,
)
async def unpublish_version(
    workspace_id: UUID,
    graph_id: UUID,
    version_id: UUID,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> GraphVersionOut:
    version = await service.unpublish_version(db, workspace_id, graph_id, version_id)
    return GraphVersionOut.model_validate(version)

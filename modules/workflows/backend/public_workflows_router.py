from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db
from libs.auth.backend.deps import require_owner
from modules.admin.backend.workspaces_models import WorkspaceMember

from . import public_workflows_service as service
from .graphs_schemas import GraphVersionOut
from .public_workflows_schemas import VersionPublishRequest

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

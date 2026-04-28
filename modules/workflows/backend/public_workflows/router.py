from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db
from libs.auth.backend.deps import require_owner
from modules.admin.backend.workspaces_models import WorkspaceMember

from . import service
from ..graphs.schemas import WorkflowVersionOut
from .schemas import VersionPublishRequest

router = APIRouter(tags=["public-workflows"])


@router.post(
    "/workspaces/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}/publish",
    response_model=WorkflowVersionOut,
)
@router.post(
    "/workspaces/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}/publish",
    response_model=WorkflowVersionOut,
    include_in_schema=False,
)
async def publish_version(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    body: VersionPublishRequest,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> WorkflowVersionOut:
    version = await service.publish_version(db, workspace_id, workflow_id, workflow_version_id, body.description_md)
    return WorkflowVersionOut.model_validate(version)


@router.delete(
    "/workspaces/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}/publish",
    response_model=WorkflowVersionOut,
)
@router.delete(
    "/workspaces/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}/publish",
    response_model=WorkflowVersionOut,
    include_in_schema=False,
)
async def unpublish_version(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> WorkflowVersionOut:
    version = await service.unpublish_version(db, workspace_id, workflow_id, workflow_version_id)
    return WorkflowVersionOut.model_validate(version)

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db

from . import notifications_service as service
from .notifications_schemas import (
    NotificationLogEntry,
    NotificationPreferenceResponse,
    NotificationPreferenceUpdate,
)

router = APIRouter(prefix="/workspaces", tags=["notifications"])


@router.get(
    "/{workspace_id}/notification-preferences",
    response_model=NotificationPreferenceResponse,
)
async def get_preferences(workspace_id: str, db: AsyncSession = Depends(get_db)):
    return await service.get_or_create_preferences(db, UUID(workspace_id))


@router.patch(
    "/{workspace_id}/notification-preferences",
    response_model=NotificationPreferenceResponse,
)
async def update_preferences(
    workspace_id: str,
    data: NotificationPreferenceUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await service.update_preferences(db, UUID(workspace_id), data)


@router.get(
    "/{workspace_id}/notification-log",
    response_model=list[NotificationLogEntry],
)
async def list_notification_log(workspace_id: str, db: AsyncSession = Depends(get_db)):
    return await service.list_notification_log(db, UUID(workspace_id))

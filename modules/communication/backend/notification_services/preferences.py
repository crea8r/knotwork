from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..notifications_models import NotificationLog, NotificationPreference
from ..notifications_schemas import NotificationPreferenceUpdate


async def get_or_create_preferences(db: AsyncSession, workspace_id: UUID) -> NotificationPreference:
    result = await db.execute(select(NotificationPreference).where(NotificationPreference.workspace_id == workspace_id))
    prefs = result.scalar_one_or_none()
    if prefs is None:
        prefs = NotificationPreference(workspace_id=workspace_id)
        db.add(prefs)
        await db.commit()
        await db.refresh(prefs)
    return prefs


async def update_preferences(db: AsyncSession, workspace_id: UUID, data: NotificationPreferenceUpdate) -> NotificationPreference:
    prefs = await get_or_create_preferences(db, workspace_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(prefs, field, value)
    await db.commit()
    await db.refresh(prefs)
    return prefs


async def list_notification_log(db: AsyncSession, workspace_id: UUID, limit: int = 50) -> list[NotificationLog]:
    result = await db.execute(
        select(NotificationLog)
        .where(NotificationLog.workspace_id == workspace_id)
        .order_by(NotificationLog.sent_at.desc())
        .limit(limit)
    )
    return list(result.scalars())


async def log_notification(
    db: AsyncSession,
    workspace_id: UUID,
    channel: str,
    status: str,
    escalation_id: UUID | None = None,
    detail: str | None = None,
) -> NotificationLog:
    entry = NotificationLog(
        workspace_id=workspace_id,
        escalation_id=escalation_id,
        channel=channel,
        status=status,
        detail=detail,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry

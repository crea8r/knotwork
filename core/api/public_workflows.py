from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from modules.workflows.backend.public_workflows_service import (
    notify_public_run_aborted as _notify_public_run_aborted,
    notify_public_run_completion as _notify_public_run_completion,
)


async def notify_public_run_aborted(db: AsyncSession, run_id: str) -> None:
    await _notify_public_run_aborted(db, run_id)


async def notify_public_run_completion(db: AsyncSession, run_id: str) -> None:
    await _notify_public_run_completion(db, run_id)

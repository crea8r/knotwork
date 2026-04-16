"""Core facade for run operations and cross-module run orchestration."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import public_workflows as core_public_workflows
from modules.workflows.backend.runs.service import create_run as _create_run
from modules.workflows.backend.runs.models import Run
from modules.workflows.backend.runtime.events import publish_event as _publish_event
from modules.workflows.backend.runtime.runner import resume_run as _resume_run


async def create_run(db: AsyncSession, **kwargs):
    return await _create_run(db, **kwargs)


async def get_run(db: AsyncSession, run_id: str):
    return await db.get(Run, run_id)


async def publish_event(run_id: str, event: dict) -> None:
    await _publish_event(run_id, event)


async def resume_run(run_id: str, resolution: dict) -> None:
    await _resume_run(run_id, resolution)


async def stop_run(db: AsyncSession, run_id: str, *, notify_public: bool = False) -> None:
    run = await get_run(db, run_id)
    if run and run.status in ("paused", "running"):
        run.status = "stopped"
        run.completed_at = datetime.now(timezone.utc)
        await db.commit()
        if notify_public:
            await core_public_workflows.notify_public_run_aborted(db, run_id)

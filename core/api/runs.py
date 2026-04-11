from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from modules.workflows.backend.runs_service import create_run as _create_run


async def create_run(db: AsyncSession, **kwargs):
    return await _create_run(db, **kwargs)

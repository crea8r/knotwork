"""
arq worker task definitions for knotwork background processing.

Run the worker with:
    arq knotwork.worker.tasks.WorkerSettings
"""

from __future__ import annotations

from arq.connections import RedisSettings

from knotwork.config import settings


async def execute_run(ctx: dict, run_id: str) -> None:
    """
    arq task: execute a knotwork run to completion (or until interrupted).

    Idempotent — exits immediately if the run is already in a terminal state.
    """
    from knotwork.runtime.engine import execute_run as _execute
    await _execute(run_id)


class WorkerSettings:
    """arq worker configuration. Discovered via `arq knotwork.worker.tasks.WorkerSettings`."""

    functions = [execute_run]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)

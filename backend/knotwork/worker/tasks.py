"""
arq worker task definitions for knotwork background processing.

Run the worker with:
    arq knotwork.worker.tasks.WorkerSettings
"""

from __future__ import annotations

# Register all ORM models with Base.metadata so FK resolution works in the
# worker process (which never imports main.py).
import knotwork.auth.models          # noqa: F401
import knotwork.workspaces.models    # noqa: F401
import knotwork.graphs.models        # noqa: F401
import knotwork.runs.models          # noqa: F401
import knotwork.knowledge.models     # noqa: F401
import knotwork.tools.models         # noqa: F401
import knotwork.escalations.models   # noqa: F401
import knotwork.ratings.models       # noqa: F401
import knotwork.audit.models         # noqa: F401

from arq.connections import RedisSettings

from knotwork.config import settings


async def execute_run(ctx: dict, run_id: str) -> None:
    """
    arq task: execute a knotwork run to completion (or until interrupted).

    Idempotent — exits immediately if the run is already in a terminal state.
    """
    from knotwork.runtime.engine import execute_run as _execute
    await _execute(run_id)


async def resume_run(ctx: dict, run_id: str, resolution: dict) -> None:
    """arq task: resume a paused run after escalation resolution."""
    from knotwork.runtime.engine import resume_run as _resume
    await _resume(run_id, resolution)


async def check_escalation_timeouts(ctx: dict) -> None:
    """
    arq cron task: time out open escalations past their deadline.

    Sets escalation status → 'timed_out' and run status → 'stopped'.
    """
    from knotwork.database import AsyncSessionLocal
    from knotwork.escalations.service import timeout_open_escalations
    from knotwork.runtime.events import publish_event
    from knotwork.runs.models import Run

    async with AsyncSessionLocal() as db:
        run_ids = await timeout_open_escalations(db)
        for run_id in run_ids:
            run = await db.get(Run, run_id)
            if run and run.status in ("paused", "running"):
                run.status = "stopped"
            await db.commit()

    for run_id in run_ids:
        await publish_event(str(run_id), {
            "type": "run_status_changed",
            "status": "stopped",
            "reason": "escalation_timeout",
        })


class WorkerSettings:
    """arq worker configuration. Discovered via `arq knotwork.worker.tasks.WorkerSettings`."""

    functions = [execute_run, resume_run]
    cron_jobs = [
        # Run timeout check every 5 minutes
        {"coroutine": check_escalation_timeouts, "minute": {0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}},
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)

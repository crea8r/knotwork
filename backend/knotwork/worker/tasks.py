"""
arq worker task definitions for knotwork background processing.

Run the worker with:
    arq knotwork.worker.tasks.WorkerSettings

Logs written to: backend/logs/worker.log
Tail with: tail -f backend/logs/worker.log
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import pathlib

# ── file logging setup ────────────────────────────────────────────────────────
_log_dir = pathlib.Path(__file__).parent.parent.parent / "logs"
_log_dir.mkdir(exist_ok=True)
_log_file = _log_dir / "worker.log"

_handler = logging.handlers.RotatingFileHandler(
    _log_file, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
)
_handler.setFormatter(logging.Formatter(
    "%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
))
logging.root.addHandler(_handler)
logging.root.setLevel(logging.INFO)

logger = logging.getLogger(__name__)
logger.info("Worker process starting — log: %s", _log_file)

# ── ORM model registration ────────────────────────────────────────────────────
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
import knotwork.notifications.models  # noqa: F401

from arq import cron
from arq.connections import RedisSettings

from knotwork.config import settings

logger.info("Worker models registered. Redis: %s", settings.redis_url)


async def execute_run(ctx: dict, run_id: str) -> None:
    """
    arq task: execute a knotwork run to completion (or until interrupted).

    Idempotent — exits immediately if the run is already in a terminal state.
    """
    logger.info("execute_run START run_id=%s", run_id)
    try:
        from knotwork.runtime.engine import execute_run as _execute
        await _execute(run_id)
        logger.info("execute_run DONE  run_id=%s", run_id)
    except Exception as exc:
        logger.exception("execute_run FAILED run_id=%s: %s", run_id, exc)
        raise


async def resume_run(ctx: dict, run_id: str, resolution: dict) -> None:
    """arq task: resume a paused run after escalation resolution."""
    logger.info("resume_run START run_id=%s resolution=%s", run_id, resolution)
    try:
        from knotwork.runtime.engine import resume_run as _resume
        await _resume(run_id, resolution)
        logger.info("resume_run DONE  run_id=%s", run_id)
    except Exception as exc:
        logger.exception("resume_run FAILED run_id=%s: %s", run_id, exc)
        raise


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

    # 24-hour safety net: kills genuinely hung jobs (DB deadlock, infinite-loop bug)
    # without affecting normal long-running OpenClaw tasks. Node-level liveness is
    # maintained by the adapter heartbeat (updates task.updated_at every 5 min).
    job_timeout = 86400

    functions = [execute_run, resume_run]
    cron_jobs = [
        # Run timeout check every 5 minutes
        cron(check_escalation_timeouts, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)

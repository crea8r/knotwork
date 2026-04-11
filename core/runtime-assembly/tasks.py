"""
arq worker task definitions for knotwork background processing.

Run the worker with:
    arq core.runtime_assembly_tasks.WorkerSettings

Logs written to: logs/worker.log
Tail with: tail -f logs/worker.log
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
import libs.auth.backend.models  # noqa: F401
import libs.audit.backend.models  # noqa: F401
import modules.admin.backend.workspaces_models  # noqa: F401
import modules.assets.backend.knowledge_models  # noqa: F401
import modules.communication.backend.escalations_models  # noqa: F401
import modules.communication.backend.notifications_models  # noqa: F401
import modules.projects.backend.projects_models  # noqa: F401
import modules.workflows.backend.graphs_models  # noqa: F401
import modules.workflows.backend.ratings_models  # noqa: F401
import modules.workflows.backend.runs_models  # noqa: F401
import modules.workflows.backend.tools_models  # noqa: F401

from arq import cron
from arq.connections import RedisSettings

from libs.config import settings

logger.info("Worker models registered. Redis: %s", settings.redis_url)


async def execute_run(ctx: dict, run_id: str) -> None:
    """
    arq task: execute a knotwork run to completion (or until interrupted).

    Idempotent — exits immediately if the run is already in a terminal state.
    """
    logger.info("execute_run START run_id=%s", run_id)
    try:
        from modules.workflows.backend.runtime.engine import execute_run as _execute
        await _execute(run_id)
        logger.info("execute_run DONE  run_id=%s", run_id)
    except Exception as exc:
        logger.exception("execute_run FAILED run_id=%s: %s", run_id, exc)
        raise


async def resume_run(ctx: dict, run_id: str, resolution: dict) -> None:
    """arq task: resume a paused run after escalation resolution."""
    logger.info("resume_run START run_id=%s resolution=%s", run_id, resolution)
    try:
        from modules.workflows.backend.runtime.engine import resume_run as _resume
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
    from libs.database import AsyncSessionLocal
    from modules.communication.backend.escalations_service import timeout_open_escalations
    from modules.workflows.backend.runtime.events import publish_event
    from modules.workflows.backend.runs_models import Run

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


async def worker_heartbeat(ctx: dict) -> None:
    """arq cron: write a liveness timestamp to Redis every 30 s (TTL 90 s)."""
    import time as _time
    import redis.asyncio as aioredis
    r = aioredis.from_url(settings.redis_url)
    await r.set("knotwork:worker:heartbeat", str(_time.time()), ex=90)
    await r.aclose()


class WorkerSettings:
    """arq worker configuration. Discovered via `arq core.runtime_assembly_tasks.WorkerSettings`."""

    # 24-hour safety net: kills genuinely hung jobs (DB deadlock, infinite-loop bug).
    job_timeout = 86400

    functions = [execute_run, resume_run]
    cron_jobs = [
        # Liveness heartbeat every 30 seconds — read by /health to confirm worker is up
        cron(worker_heartbeat, second={0, 30}),
        # Run timeout check every 5 minutes
        cron(check_escalation_timeouts, minute={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)

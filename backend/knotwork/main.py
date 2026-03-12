import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from time import monotonic

from fastapi import FastAPI

# Attach a stdout handler to the knotwork logger so INFO+ messages are always
# visible in docker compose logs, regardless of uvicorn's root-logger config.
_kw_logger = logging.getLogger("knotwork")
_kw_logger.setLevel(logging.INFO)
if not _kw_logger.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(levelname)s  [%(name)s] %(message)s"))
    _kw_logger.addHandler(_h)
_kw_logger.propagate = False  # avoid double-printing via root logger
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

# Register all ORM models with Base.metadata before any DB operations.
# Without these imports, FK resolution fails at flush time.
import knotwork.auth.models          # noqa: F401
import knotwork.workspaces.models    # noqa: F401
import knotwork.workspaces.invitations.models  # noqa: F401
import knotwork.graphs.models        # noqa: F401
import knotwork.runs.models          # noqa: F401
import knotwork.knowledge.models     # noqa: F401
import knotwork.tools.models         # noqa: F401
import knotwork.escalations.models   # noqa: F401
import knotwork.ratings.models       # noqa: F401
import knotwork.audit.models         # noqa: F401
import knotwork.notifications.models  # noqa: F401
import knotwork.designer.models       # noqa: F401
import knotwork.registered_agents.models  # noqa: F401
import knotwork.channels.models  # noqa: F401
import knotwork.openclaw_integrations.models  # noqa: F401
import knotwork.public_workflows.models  # noqa: F401

# Import new S6.5 models so they are registered with Base.metadata
from knotwork.runs.models import RunHandbookProposal, RunWorklogEntry  # noqa: F401

from knotwork.auth.router import router as auth_router
from knotwork.escalations.router import router as escalations_router
from knotwork.graphs.router import router as graphs_router
from knotwork.knowledge.router import router as knowledge_router
from knotwork.knowledge.proposals_router import router as proposals_router
from knotwork.ratings.router import router as ratings_router
from knotwork.runs.router import router as runs_router
from knotwork.runs.ws import ws_router
from knotwork.notifications.router import router as notifications_router
from knotwork.tools.router import router as tools_router
from knotwork.workspaces.router import router as workspaces_router
from knotwork.agent_api.router import router as agent_api_router
from knotwork.registered_agents.router import router as registered_agents_router
from knotwork.channels.router import router as channels_router
from knotwork.openclaw_integrations.router import (
    plugin_router as openclaw_plugin_router,
)
from knotwork.openclaw_integrations.router import router as openclaw_router
from knotwork.workspaces.invitations.router import router as invitations_router
from knotwork.workspaces.invitations.router import public_router as invitations_public_router
from knotwork.openclaw_integrations.install_router import router as openclaw_install_router
from knotwork.public_workflows.router import router as public_workflows_router
from knotwork.public_workflows.router import public_router as public_workflows_public_router
from knotwork.database import AsyncSessionLocal

_STARTED_AT = datetime.now(timezone.utc)
_START_MONOTONIC = monotonic()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialise storage adapter, verify DB connection
    yield
    # Shutdown: close connections


def create_app() -> FastAPI:
    app = FastAPI(title="Knotwork API", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # tighten in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    prefix = "/api/v1"
    app.include_router(auth_router, prefix=prefix)
    app.include_router(workspaces_router, prefix=prefix)
    app.include_router(graphs_router, prefix=prefix)
    app.include_router(runs_router, prefix=prefix)
    app.include_router(knowledge_router, prefix=prefix)
    app.include_router(proposals_router, prefix=prefix)
    app.include_router(tools_router, prefix=prefix)
    app.include_router(notifications_router, prefix=prefix)
    app.include_router(escalations_router, prefix=prefix)
    app.include_router(ratings_router, prefix=prefix)
    app.include_router(ws_router, prefix=prefix)
    app.include_router(registered_agents_router, prefix=prefix)
    app.include_router(channels_router, prefix=prefix)
    app.include_router(openclaw_router, prefix=prefix)
    app.include_router(invitations_router, prefix=prefix)
    app.include_router(invitations_public_router, prefix=prefix)
    app.include_router(public_workflows_router, prefix=prefix)
    app.include_router(public_workflows_public_router, prefix=prefix)
    app.include_router(agent_api_router)  # no /api/v1 prefix — agents use /agent-api
    app.include_router(openclaw_plugin_router)  # no /api/v1 prefix — plugin callback
    app.include_router(openclaw_install_router)  # no /api/v1 prefix — plugin install

    @app.get("/health")
    async def healthcheck():
        db_start = monotonic()
        db_status = "ok"
        db_error = None
        try:
            async with AsyncSessionLocal() as db:
                await db.execute(text("SELECT 1"))
        except Exception as exc:  # pragma: no cover - defensive for runtime checks
            db_status = "error"
            db_error = str(exc)
        db_latency_ms = round((monotonic() - db_start) * 1000, 2)

        now = datetime.now(timezone.utc)
        uptime_seconds = round(monotonic() - _START_MONOTONIC, 2)
        payload = {
            "service": "knotwork-api",
            "status": "ok" if db_status == "ok" else "degraded",
            "version": app.version,
            "now_utc": now.isoformat(),
            "started_at_utc": _STARTED_AT.isoformat(),
            "uptime_seconds": uptime_seconds,
            "checks": {
                "database": {
                    "status": db_status,
                    "latency_ms": db_latency_ms,
                    "error": db_error,
                },
            },
        }
        status_code = 200 if db_status == "ok" else 503
        return JSONResponse(status_code=status_code, content=payload)

    return app


app = create_app()

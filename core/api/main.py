import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Attach a stdout handler to the knotwork logger so INFO+ messages are always
# visible in docker compose logs, regardless of uvicorn's root-logger config.
_kw_logger = logging.getLogger("knotwork")
_kw_logger.setLevel(logging.INFO)
if not _kw_logger.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(levelname)s  [%(name)s] %(message)s"))
    _kw_logger.addHandler(_h)
_kw_logger.propagate = False  # avoid double-printing via root logger

# Register all ORM models with Base.metadata before any DB operations.
# Without these imports, FK resolution fails at flush time.
import libs.auth.backend.models  # noqa: F401
import libs.audit.backend.models  # noqa: F401
import modules.admin.backend.invitations_models  # noqa: F401
import modules.admin.backend.workspaces_models  # noqa: F401
import modules.assets.backend.knowledge_models  # noqa: F401
import modules.communication.backend.channels_models  # noqa: F401
import modules.communication.backend.escalations_models  # noqa: F401
import modules.communication.backend.notifications_models  # noqa: F401
import modules.projects.backend.projects_models  # noqa: F401
import modules.workflows.backend.graphs_models  # noqa: F401
import modules.workflows.backend.public_workflows_models  # noqa: F401
import modules.workflows.backend.ratings_models  # noqa: F401
import modules.workflows.backend.runs_models  # noqa: F401
import modules.workflows.backend.tools_models  # noqa: F401
import modules.marketing.backend.waitlist_models  # noqa: F401

from core.api.health import (
    initialize_health_state,
    load_or_create_installation_id,
    read_schema_version,
    register_health_route,
)
from core.mcp.server import build_server
from core.api.router import mount_routers


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_health_state(
        installation_id=load_or_create_installation_id(),
        schema_version=await read_schema_version(),
    )
    mcp_server = getattr(app.state, "mcp_server", None)
    if mcp_server is None:
        yield
        return
    async with mcp_server.session_manager.run():
        yield


def create_app() -> FastAPI:
    app = FastAPI(title="Knotwork API", version="0.1.0", lifespan=lifespan)
    mcp_server = build_server()
    app.state.mcp_server = mcp_server

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # tighten in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    mount_routers(app)
    app.mount("/mcp", mcp_server.streamable_http_app())
    register_health_route(app)

    return app


app = create_app()

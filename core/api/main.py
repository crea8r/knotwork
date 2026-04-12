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

from core.api.health import (
    initialize_health_state,
    load_or_create_installation_id,
    read_schema_version,
    register_health_route,
)
from core.api.distribution import get_active_backend_distribution
from core.mcp.server import build_server
from core.api.router import mount_routers

_active_distribution_code, _register_models, _ = get_active_backend_distribution()
_register_models()


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
    app = FastAPI(title=f"Knotwork API ({_active_distribution_code})", version="0.1.0", lifespan=lifespan)
    mcp_server = build_server()
    app.state.mcp_server = mcp_server
    app.state.distribution_code = _active_distribution_code

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

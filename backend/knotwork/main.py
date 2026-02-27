from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Register all ORM models with Base.metadata before any DB operations.
# Without these imports, FK resolution fails at flush time.
import knotwork.auth.models          # noqa: F401
import knotwork.workspaces.models    # noqa: F401
import knotwork.graphs.models        # noqa: F401
import knotwork.runs.models          # noqa: F401
import knotwork.knowledge.models     # noqa: F401
import knotwork.tools.models         # noqa: F401
import knotwork.escalations.models   # noqa: F401
import knotwork.ratings.models       # noqa: F401
import knotwork.audit.models         # noqa: F401

from knotwork.auth.router import router as auth_router
from knotwork.escalations.router import router as escalations_router
from knotwork.graphs.router import router as graphs_router
from knotwork.knowledge.router import router as knowledge_router
from knotwork.ratings.router import router as ratings_router
from knotwork.runs.router import router as runs_router
from knotwork.runs.ws import ws_router
from knotwork.tools.router import router as tools_router
from knotwork.workspaces.router import router as workspaces_router


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
    app.include_router(tools_router, prefix=prefix)
    app.include_router(escalations_router, prefix=prefix)
    app.include_router(ratings_router, prefix=prefix)
    app.include_router(ws_router, prefix=prefix)

    return app


app = create_app()

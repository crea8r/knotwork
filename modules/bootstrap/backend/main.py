from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from modules.bootstrap.backend.setup_router import router as setup_router


def create_app() -> FastAPI:
    app = FastAPI(title="Knotwork Bootstrap API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(setup_router, prefix="/api/v1")
    return app


app = create_app()

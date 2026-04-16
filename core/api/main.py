"""ASGI entrypoint for Uvicorn and Docker commands."""

from core.api.bootstrap.main import app, create_app

__all__ = ["app", "create_app"]

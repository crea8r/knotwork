from fastapi import FastAPI
from core.api.distribution import get_active_backend_distribution


def mount_routers(app: FastAPI, *, prefix: str = "/api/v1") -> None:
    _, _, mount_distribution_routers = get_active_backend_distribution()
    mount_distribution_routers(app, prefix=prefix)

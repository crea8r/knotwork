"""Backend app bootstrap and distribution assembly."""

from .distribution import get_active_backend_distribution, get_active_backend_modules
from .health import (
    initialize_health_state,
    load_or_create_installation_id,
    read_schema_version,
    register_health_route,
)
from .main import app, create_app
from .router import mount_routers

__all__ = [
    "app",
    "create_app",
    "get_active_backend_distribution",
    "get_active_backend_modules",
    "initialize_health_state",
    "load_or_create_installation_id",
    "mount_routers",
    "read_schema_version",
    "register_health_route",
]

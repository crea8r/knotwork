from .discovery_router import router as agent_discovery_router
from .installations_router import router as agent_installations_router

__all__ = [
    "agent_discovery_router",
    "agent_installations_router",
]

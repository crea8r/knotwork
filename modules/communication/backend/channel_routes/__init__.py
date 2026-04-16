from .assets import router as assets_router
from .catalog import router as catalog_router
from .handbook import router as handbook_router
from .inbox import router as inbox_router
from .messages import router as messages_router

__all__ = ["assets_router", "catalog_router", "handbook_router", "inbox_router", "messages_router"]

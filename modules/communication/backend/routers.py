from modules.communication.backend.channels_router import router as channels_router
from modules.communication.backend.notifications_router import router as notifications_router
from core.mcp.contracts.router import router as mcp_contracts_router

__all__ = ["channels_router", "notifications_router", "mcp_contracts_router"]

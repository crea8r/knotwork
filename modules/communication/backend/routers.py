from modules.communication.backend.channels_router import router as channels_router
from modules.communication.backend.escalations_router import router as escalations_router
from modules.communication.backend.notifications_router import router as notifications_router

__all__ = ["channels_router", "escalations_router", "notifications_router"]

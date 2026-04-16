from fastapi import APIRouter

from .channel_routes import assets_router, catalog_router, handbook_router, inbox_router, messages_router

router = APIRouter(prefix="/workspaces", tags=["channels"])
router.include_router(catalog_router)
router.include_router(assets_router)
router.include_router(messages_router)
router.include_router(handbook_router)
router.include_router(inbox_router)

__all__ = ["router"]

from fastapi import FastAPI

from core.api.agent_sessions import router as agent_sessions_router
from core.mcp.contracts.router import router as mcp_contracts_router
from modules.admin.backend.routers import (
    auth_router,
    invitations_public_router,
    invitations_router,
    workspaces_router,
    workspaces_skills_router,
    workspaces_well_known_router,
)
from modules.assets.backend.routers import (
    knowledge_folder_router,
    knowledge_proposals_router as proposals_router,
    knowledge_router,
    knowledge_upload_router,
    project_assets_router,
)
from modules.workflows.backend.agent_api.router import router as agent_api_router
from modules.workflows.backend.routers import (
    escalations_router,
    graphs_router,
    public_workflows_public_router,
    public_workflows_router,
    runs_router,
    ws_router,
)
from .manifest import ENABLED_BACKEND_FEATURES, ENABLED_BACKEND_MODULES


def mount_routers(app: FastAPI, *, prefix: str = "/api/v1") -> None:
    enabled_modules = set(ENABLED_BACKEND_MODULES)
    enabled_features = set(ENABLED_BACKEND_FEATURES)

    if "admin" in enabled_modules:
        app.include_router(auth_router, prefix=prefix)
        app.include_router(workspaces_router, prefix=prefix)
        app.include_router(workspaces_skills_router, prefix=prefix)
        app.include_router(workspaces_well_known_router, prefix=prefix)
        app.include_router(invitations_router, prefix=prefix)
        app.include_router(invitations_public_router, prefix=prefix)

    if "workflows" in enabled_modules:
        app.include_router(graphs_router, prefix=prefix)
        app.include_router(escalations_router, prefix=prefix)
        app.include_router(runs_router, prefix=prefix)
        if "websocket_runs" in enabled_features:
            app.include_router(ws_router, prefix=prefix)
        if "public_workflows" in enabled_features:
            app.include_router(public_workflows_router, prefix=prefix)
            app.include_router(public_workflows_public_router, prefix=prefix)
        if "agent_api" in enabled_features:
            app.include_router(agent_api_router)

    if "assets" in enabled_modules:
        app.include_router(knowledge_router, prefix=prefix)
        app.include_router(knowledge_folder_router, prefix=prefix)
        app.include_router(knowledge_upload_router, prefix=prefix)
        app.include_router(proposals_router, prefix=prefix)
        app.include_router(project_assets_router, prefix=prefix)

    app.include_router(mcp_contracts_router, prefix=prefix)
    app.include_router(agent_sessions_router, prefix=prefix)

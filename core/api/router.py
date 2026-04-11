from fastapi import FastAPI

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
)
from modules.communication.backend.routers import (
    channels_router,
    escalations_router,
    notifications_router,
)
from modules.projects.backend.routers import projects_router
from modules.workflows.backend.agent_api.router import router as agent_api_router
from modules.workflows.backend.routers import (
    graphs_router,
    public_workflows_public_router,
    public_workflows_router,
    ratings_router,
    runs_router,
    tools_router,
    ws_router,
)


def mount_routers(app: FastAPI, *, prefix: str = "/api/v1") -> None:
    app.include_router(auth_router, prefix=prefix)
    app.include_router(workspaces_router, prefix=prefix)
    app.include_router(workspaces_skills_router, prefix=prefix)
    app.include_router(workspaces_well_known_router, prefix=prefix)
    app.include_router(graphs_router, prefix=prefix)
    app.include_router(runs_router, prefix=prefix)
    app.include_router(knowledge_router, prefix=prefix)
    app.include_router(knowledge_folder_router, prefix=prefix)
    app.include_router(knowledge_upload_router, prefix=prefix)
    app.include_router(proposals_router, prefix=prefix)
    app.include_router(tools_router, prefix=prefix)
    app.include_router(notifications_router, prefix=prefix)
    app.include_router(escalations_router, prefix=prefix)
    app.include_router(ratings_router, prefix=prefix)
    app.include_router(ws_router, prefix=prefix)
    app.include_router(channels_router, prefix=prefix)
    app.include_router(projects_router, prefix=prefix)
    app.include_router(invitations_router, prefix=prefix)
    app.include_router(invitations_public_router, prefix=prefix)
    app.include_router(public_workflows_router, prefix=prefix)
    app.include_router(public_workflows_public_router, prefix=prefix)
    app.include_router(agent_api_router)  # no /api/v1 prefix — agents use /agent-api

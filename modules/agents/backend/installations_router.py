from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from libs.auth.backend.deps import get_workspace_member
from modules.admin.backend.workspaces_models import WorkspaceMember

from .harnesses.registry import HarnessInstallOption, list_harness_install_options

router = APIRouter(prefix="/workspaces", tags=["agents"])


class AgentHarnessCatalog(BaseModel):
    workspace_id: str
    harnesses: list[HarnessInstallOption]


@router.get("/{workspace_id}/agent-harnesses", response_model=AgentHarnessCatalog)
async def list_agent_harnesses(
    workspace_id: UUID,
    _member: WorkspaceMember = Depends(get_workspace_member),
) -> AgentHarnessCatalog:
    return AgentHarnessCatalog(
        workspace_id=str(workspace_id),
        harnesses=list_harness_install_options(),
    )

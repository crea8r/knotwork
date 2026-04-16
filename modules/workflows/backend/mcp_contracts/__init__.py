from core.mcp.contracts.schemas import MCPContract

from .run_contracts import (
    RUN_ACTION_NAMES,
    WorkflowSessionSpec,
    build_run_session_specs,
    execute_run_action,
    resolve_run_session_contract,
)
from .workflow_edit_contracts import (
    WORKFLOW_EDIT_ACTION_NAMES,
    build_workflow_edit_session_specs,
    execute_workflow_edit_action,
    resolve_workflow_edit_session_contract,
)

WORKFLOW_ACTION_NAMES = RUN_ACTION_NAMES | WORKFLOW_EDIT_ACTION_NAMES


def build_workflow_session_specs() -> dict[str, WorkflowSessionSpec]:
    return {
        **build_run_session_specs(),
        **build_workflow_edit_session_specs(),
    }


def resolve_workflow_session_contract(context: dict, *, manifests: dict) -> MCPContract | None:
    return resolve_run_session_contract(context, manifests=manifests) or resolve_workflow_edit_session_contract(
        context, manifests=manifests
    )


async def execute_workflow_action(*args, action_name: str, **kwargs):
    if action_name in RUN_ACTION_NAMES:
        return await execute_run_action(*args, action_name=action_name, **kwargs)
    if action_name in WORKFLOW_EDIT_ACTION_NAMES:
        return await execute_workflow_edit_action(*args, action_name=action_name, **kwargs)
    raise ValueError(f"Unsupported workflow MCP contract action: {action_name}")

__all__ = [
    "WORKFLOW_ACTION_NAMES",
    "WorkflowSessionSpec",
    "build_workflow_session_specs",
    "execute_workflow_action",
    "resolve_workflow_session_contract",
]

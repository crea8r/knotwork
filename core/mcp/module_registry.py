from __future__ import annotations

from core.mcp.agent_sessions import register_mcp_tools as register_agent_session_mcp_tools
from core.mcp.runtime import KnotworkMCPRuntime, ModuleMCPRegistrar

from modules.admin.backend.mcp import register_mcp_tools as register_admin_mcp_tools
from modules.assets.backend.mcp import register_mcp_tools as register_assets_mcp_tools
from modules.communication.backend.mcp import register_mcp_tools as register_communication_mcp_tools
from modules.projects.backend.mcp import register_mcp_tools as register_projects_mcp_tools
from modules.workflows.backend.mcp import register_mcp_tools as register_workflows_mcp_tools

_MODULE_MCP_REGISTRARS: dict[str, ModuleMCPRegistrar] = {
    "admin": register_admin_mcp_tools,
    "assets": register_assets_mcp_tools,
    "communication": register_communication_mcp_tools,
    "projects": register_projects_mcp_tools,
    "workflows": register_workflows_mcp_tools,
}


def register_enabled_module_mcp_tools(*, mcp, runtime: KnotworkMCPRuntime) -> None:
    from core.api.bootstrap.distribution import get_active_backend_modules

    register_agent_session_mcp_tools(mcp, runtime)
    for module_name in get_active_backend_modules():
        registrar = _MODULE_MCP_REGISTRARS.get(module_name)
        if registrar is None:
            continue
        registrar(mcp, runtime)


def enabled_module_names() -> tuple[str, ...]:
    from core.api.bootstrap.distribution import get_active_backend_modules

    return get_active_backend_modules()

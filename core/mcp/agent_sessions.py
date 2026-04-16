from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    @mcp.tool()
    async def build_mcp_work_packet(
        task_id: str,
        trigger: dict[str, Any],
        session_name: str | None = None,
        legacy_user_prompt: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path("/mcp/work-packets"),
            body={
                "task_id": task_id,
                "trigger": trigger,
                "session_name": session_name,
                "legacy_user_prompt": legacy_user_prompt,
            },
        )

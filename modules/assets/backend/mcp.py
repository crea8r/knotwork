from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    @mcp.tool()
    async def list_knowledge_files(project_id: str | None = None, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        params = {"project_id": project_id} if project_id else None
        return await runtime.request(ctx, "GET", api.workspace_path("/knowledge"), params=params)

    @mcp.tool()
    async def read_knowledge_file(
        path: str,
        project_id: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        params: dict[str, Any] = {"path": path}
        if project_id:
            params["project_id"] = project_id
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path("/knowledge/file"),
            params=params,
        )

    @mcp.tool()
    async def create_knowledge_file(
        path: str,
        title: str,
        content: str,
        change_summary: str | None = None,
        project_id: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        params = {"project_id": project_id} if project_id else None
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path("/knowledge"),
            params=params,
            body={
                "path": path,
                "title": title,
                "content": content,
                "change_summary": change_summary,
            },
        )

    @mcp.tool()
    async def update_knowledge_file(
        path: str,
        content: str,
        change_summary: str | None = None,
        project_id: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        params: dict[str, Any] = {"path": path}
        if project_id:
            params["project_id"] = project_id
        return await runtime.request(
            ctx,
            "PUT",
            api.workspace_path("/knowledge/file"),
            params=params,
            body={"content": content, "change_summary": change_summary},
        )

    @mcp.tool()
    async def list_knowledge_changes(status: str | None = None, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        params = {"status": status} if status else None
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path("/knowledge/changes"),
            params=params,
        )

    @mcp.tool()
    async def create_knowledge_change(
        path: str,
        proposed_content: str,
        reason: str,
        run_id: str | None = None,
        node_id: str | None = None,
        agent_ref: str | None = None,
        source_channel_id: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path("/knowledge/changes"),
            body={
                "path": path,
                "proposed_content": proposed_content,
                "reason": reason,
                "run_id": run_id,
                "node_id": node_id,
                "agent_ref": agent_ref,
                "source_channel_id": source_channel_id,
            },
        )

    @mcp.tool()
    async def approve_knowledge_change(
        proposal_id: str,
        final_content: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path(f"/knowledge/changes/{proposal_id}/approve"),
            body={"final_content": final_content},
        )

    @mcp.tool()
    async def reject_knowledge_change(proposal_id: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path(f"/knowledge/changes/{proposal_id}/reject"),
            body={},
        )

    @mcp.tool()
    async def list_handbook_proposals(status: str | None = None, ctx: Context = None) -> Any:
        return await list_knowledge_changes(status=status, ctx=ctx)

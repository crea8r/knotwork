from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime


async def _get_objective_chain(
    *,
    runtime: KnotworkMCPRuntime,
    ctx: Context | None,
    objective_ref: str,
) -> list[dict[str, Any]]:
    api = runtime.client_from_context(ctx)
    chain: list[dict[str, Any]] = []
    seen: set[str] = set()
    current_ref: str | None = objective_ref

    while current_ref:
        if current_ref in seen:
            raise RuntimeError(f"Objective ancestry cycle detected at {current_ref}")
        seen.add(current_ref)
        objective = await runtime.request(
            ctx,
            "GET",
            api.workspace_path(f"/objectives/{current_ref}"),
        )
        if not isinstance(objective, dict):
            raise RuntimeError(f"Unexpected objective payload for {current_ref}")
        chain.append(objective)
        parent_ref = objective.get("parent_objective_id")
        current_ref = str(parent_ref) if parent_ref else None

    return list(reversed(chain))


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    @mcp.tool()
    async def list_projects(ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path("/projects"))

    @mcp.tool()
    async def create_project(
        title: str,
        description: str,
        status: str = "open",
        deadline: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path("/projects"),
            body={
                "title": title,
                "description": description,
                "status": status,
                "deadline": deadline,
            },
        )

    @mcp.tool()
    async def get_project(project_ref: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path(f"/projects/{project_ref}"))

    @mcp.tool()
    async def update_project(project_ref: str, updates: dict[str, Any], ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "PATCH",
            api.workspace_path(f"/projects/{project_ref}"),
            body=updates,
        )

    @mcp.tool()
    async def get_project_dashboard(project_ref: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path(f"/projects/{project_ref}/dashboard"),
        )

    @mcp.tool()
    async def list_objectives(project_id: str | None = None, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        params = {"project_id": project_id} if project_id else None
        return await runtime.request(ctx, "GET", api.workspace_path("/objectives"), params=params)

    @mcp.tool()
    async def create_objective(
        title: str,
        project_id: str | None = None,
        description: str | None = None,
        status: str = "open",
        progress_percent: int = 0,
        status_summary: str | None = None,
        key_results: list[str] | None = None,
        parent_objective_id: str | None = None,
        owner_type: str | None = None,
        owner_name: str | None = None,
        code: str | None = None,
        deadline: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path("/objectives"),
            body={
                "title": title,
                "project_id": project_id,
                "description": description,
                "status": status,
                "progress_percent": progress_percent,
                "status_summary": status_summary,
                "key_results": key_results or [],
                "parent_objective_id": parent_objective_id,
                "owner_type": owner_type,
                "owner_name": owner_name,
                "code": code,
                "deadline": deadline,
                "origin_type": "manual",
            },
        )

    @mcp.tool()
    async def get_objective(objective_ref: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path(f"/objectives/{objective_ref}"))

    @mcp.tool()
    async def get_objective_chain(objective_ref: str, ctx: Context = None) -> Any:
        return await _get_objective_chain(runtime=runtime, ctx=ctx, objective_ref=objective_ref)

    @mcp.tool()
    async def update_objective(
        objective_ref: str,
        updates: dict[str, Any],
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "PATCH",
            api.workspace_path(f"/objectives/{objective_ref}"),
            body=updates,
        )

    @mcp.tool()
    async def list_project_channels(
        project_ref: str,
        include_archived: bool = False,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path(f"/projects/{project_ref}/channels"),
            params={"include_archived": include_archived},
        )

    @mcp.tool()
    async def create_project_status_update(
        project_ref: str,
        summary: str,
        author_type: str = "human",
        author_name: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path(f"/projects/{project_ref}/status-updates"),
            body={
                "summary": summary,
                "author_type": author_type,
                "author_name": author_name,
            },
        )

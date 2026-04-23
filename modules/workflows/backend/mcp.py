from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    @mcp.resource(
        "knotwork://runs/active",
        name="active_runs",
        title="Active Runs",
        description="All non-terminal runs for the configured workspace.",
        mime_type="application/json",
    )
    async def active_runs_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        runs = await runtime.request(mcp.get_context(), "GET", api.workspace_path("/runs"))
        terminal = {"completed", "failed", "stopped"}
        active_runs = [run for run in runs if run.get("status") not in terminal]
        return runtime.json_text(active_runs)

    @mcp.tool()
    async def list_graphs(project_id: str | None = None, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        params = {"project_id": project_id} if project_id else None
        return await runtime.request(ctx, "GET", api.workspace_path("/graphs"), params=params)

    @mcp.tool()
    async def create_graph(
        name: str,
        description: str | None = None,
        path: str = "",
        default_model: str | None = None,
        project_id: str | None = None,
        definition: dict[str, Any] | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path("/graphs"),
            body={
                "name": name,
                "description": description,
                "path": path,
                "default_model": default_model,
                "project_id": project_id,
                "definition": definition or {},
            },
        )

    @mcp.tool()
    async def get_graph(graph_id: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path(f"/graphs/{graph_id}"))

    @mcp.tool()
    async def get_graph_by_path(path: str, project_id: str | None = None, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        params = {"path": path}
        if project_id:
            params["project_id"] = project_id
        return await runtime.request(ctx, "GET", api.workspace_path("/graphs/by-path"), params=params)

    @mcp.tool()
    async def get_graph_root_draft(graph_id: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path(f"/graphs/{graph_id}/root-draft"),
        )

    @mcp.tool()
    async def update_graph_root_draft(
        graph_id: str,
        definition: dict[str, Any],
        note: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "PUT",
            api.workspace_path(f"/graphs/{graph_id}/root-draft"),
            body={
                "definition": definition,
                "note": note,
            },
        )

    @mcp.tool()
    async def list_runs(status: str | None = None, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        runs = await runtime.request(ctx, "GET", api.workspace_path("/runs"))
        if not status:
            return runs
        terminal = {"completed", "failed", "stopped"}
        if status == "active":
            return [run for run in runs if run.get("status") not in terminal]
        return [run for run in runs if run.get("status") == status]

    @mcp.tool()
    async def get_run(run_id: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}"))

    @mcp.tool()
    async def list_run_nodes(run_id: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path(f"/runs/{run_id}/nodes"))

    @mcp.tool()
    async def trigger_run(
        graph_id: str,
        name: str | None = None,
        input: dict[str, Any] | None = None,
        graph_version_id: str | None = None,
        objective_id: str | None = None,
        source_channel_id: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        body: dict[str, Any] = {
            "name": name,
            "input": input or {},
            "graph_version_id": graph_version_id,
            "objective_id": objective_id,
            "source_channel_id": source_channel_id,
            "trigger": "manual",
            "context_files": [],
        }
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path(f"/graphs/{graph_id}/runs"),
            body=body,
        )

    @mcp.tool()
    async def abort_run(run_id: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "POST", api.workspace_path(f"/runs/{run_id}/abort"))

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


def _apply_key_result_changes(current: list[str], changes: list[Any]) -> list[str]:
    key_results = [item.strip() for item in current if item and item.strip()]
    for change in changes:
        if isinstance(change, str):
            item = change.strip()
            if item and item not in key_results:
                key_results.append(item)
            continue
        if not isinstance(change, dict):
            continue
        action = str(change.get("action") or "add").strip().lower()
        values_raw = change.get("values")
        values: list[str]
        if isinstance(values_raw, list):
            values = [str(item).strip() for item in values_raw if str(item).strip()]
        else:
            single = str(change.get("value") or "").strip()
            values = [single] if single else []
        if action in {"set", "replace"}:
            key_results = values
        elif action in {"add", "append"}:
            for value in values:
                if value not in key_results:
                    key_results.append(value)
        elif action == "remove":
            removals = set(values)
            key_results = [value for value in key_results if value not in removals]
    return key_results


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    @mcp.resource(
        "knotwork://projects/list",
        name="projects_list",
        title="Projects",
        description="All projects visible in the current workspace.",
        mime_type="application/json",
    )
    async def projects_list_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        return runtime.json_text(await runtime.request(mcp.get_context(), "GET", api.workspace_path("/projects")))

    @mcp.resource(
        "knotwork://projects/{project_ref}",
        name="project_detail",
        title="Project Detail",
        description="Project detail for one project ref.",
        mime_type="application/json",
    )
    async def project_resource(project_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/projects/{project_ref}")))

    @mcp.resource(
        "knotwork://projects/{project_ref}/dashboard",
        name="project_dashboard",
        title="Project Dashboard",
        description="Dashboard context for one project.",
        mime_type="application/json",
    )
    async def project_dashboard_resource(project_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(
            await runtime.request(ctx, "GET", api.workspace_path(f"/projects/{project_ref}/dashboard"))
        )

    @mcp.resource(
        "knotwork://projects/{project_ref}/channels",
        name="project_channels",
        title="Project Channels",
        description="Channels attached to a project.",
        mime_type="application/json",
    )
    async def project_channels_resource(project_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(
            await runtime.request(ctx, "GET", api.workspace_path(f"/projects/{project_ref}/channels"))
        )

    @mcp.resource(
        "knotwork://projects/{project_ref}/status",
        name="project_status",
        title="Project Status",
        description="Project status snapshot and latest status update.",
        mime_type="application/json",
    )
    async def project_status_resource(project_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        project = await runtime.request(ctx, "GET", api.workspace_path(f"/projects/{project_ref}"))
        dashboard = await runtime.request(ctx, "GET", api.workspace_path(f"/projects/{project_ref}/dashboard"))
        return runtime.json_text(
            {
                "project_ref": project_ref,
                "status": project.get("status") if isinstance(project, dict) else None,
                "latest_status_update": dashboard.get("latest_status_update") if isinstance(dashboard, dict) else None,
                "open_objective_count": project.get("open_objective_count") if isinstance(project, dict) else None,
                "objective_count": project.get("objective_count") if isinstance(project, dict) else None,
                "run_count": project.get("run_count") if isinstance(project, dict) else None,
            }
        )

    @mcp.resource(
        "knotwork://projects/objectives",
        name="projects_objectives",
        title="Objectives",
        description="Objectives visible in the current workspace.",
        mime_type="application/json",
    )
    async def objectives_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        return runtime.json_text(await runtime.request(mcp.get_context(), "GET", api.workspace_path("/objectives")))

    @mcp.resource(
        "knotwork://projects/objective/{objective_ref}",
        name="project_objective_detail",
        title="Objective Detail",
        description="Objective detail for one objective ref.",
        mime_type="application/json",
    )
    async def objective_resource(objective_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/objectives/{objective_ref}")))

    @mcp.resource(
        "knotwork://projects/objective/{objective_ref}/chain",
        name="project_objective_chain",
        title="Objective Chain",
        description="Objective ancestry chain from root to the requested objective.",
        mime_type="application/json",
    )
    async def objective_chain_resource(objective_ref: str, ctx: Context = None) -> str:
        return runtime.json_text(await _get_objective_chain(runtime=runtime, ctx=ctx, objective_ref=objective_ref))

    @mcp.resource(
        "knotwork://projects/objective/{objective_ref}/children",
        name="project_objective_children",
        title="Objective Children",
        description="Immediate child objectives for one objective ref.",
        mime_type="application/json",
    )
    async def objective_children_resource(objective_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        objective = await runtime.request(ctx, "GET", api.workspace_path(f"/objectives/{objective_ref}"))
        project_id = objective.get("project_id") if isinstance(objective, dict) else None
        params = {"project_id": project_id} if project_id else None
        objectives = await runtime.request(ctx, "GET", api.workspace_path("/objectives"), params=params)
        rows = objectives if isinstance(objectives, list) else []
        children = [
            row for row in rows
            if isinstance(row, dict) and str(row.get("parent_objective_id") or "") == str(objective.get("id") or "")
        ]
        return runtime.json_text(children)

    @mcp.prompt(
        name="projects.break_down_objective",
        title="Break Down Objective",
        description="Guidance for breaking down a larger objective into smaller work.",
    )
    def break_down_objective_prompt() -> str:
        return (
            "Break the objective into concrete child objectives or milestones.\n"
            "Prefer clear ownership and a measurable next state."
        )

    @mcp.prompt(
        name="projects.refine_objective_scope",
        title="Refine Objective Scope",
        description="Guidance for tightening objective scope.",
    )
    def refine_objective_scope_prompt() -> str:
        return (
            "Refine the objective so scope, status, and success criteria are explicit.\n"
            "Remove vague or overlapping work."
        )

    @mcp.prompt(
        name="projects.create_status_update",
        title="Create Status Update",
        description="Guidance for creating a project status update.",
    )
    def create_status_update_prompt() -> str:
        return (
            "Create a short project status update that explains what changed, why it matters, and what should happen next."
        )

    @mcp.prompt(
        name="projects.route_project_work",
        title="Route Project Work",
        description="Guidance for routing project work to the right next owner or module.",
    )
    def route_project_work_prompt() -> str:
        return (
            "Route the project work to the next clear owner or module.\n"
            "Use project and objective state first, then supporting communication or member context."
        )

    @mcp.prompt(
        name="projects.summarize_project_health",
        title="Summarize Project Health",
        description="Guidance for summarizing overall project health.",
    )
    def summarize_project_health_prompt() -> str:
        return (
            "Summarize project health from objective status, blockers, recent runs, and the latest status update."
        )

    @mcp.tool(name="knotwork_objective_update")
    async def knotwork_objective_update(
        objective_ref: str,
        description: str | None = None,
        status: str | None = None,
        progress_percent: int | None = None,
        status_summary: str | None = None,
        key_result_changes: list[Any] | None = None,
        owner_type: str | None = None,
        owner_name: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        updates: dict[str, Any] = {}
        if description is not None:
            updates["description"] = description
        if status is not None:
            updates["status"] = status
        if progress_percent is not None:
            updates["progress_percent"] = progress_percent
        if status_summary is not None:
            updates["status_summary"] = status_summary
        if owner_type is not None:
            updates["owner_type"] = owner_type
        if owner_name is not None:
            updates["owner_name"] = owner_name
        if key_result_changes is not None:
            current = await runtime.request(ctx, "GET", api.workspace_path(f"/objectives/{objective_ref}"))
            updates["key_results"] = _apply_key_result_changes(
                list(current.get("key_results") or []) if isinstance(current, dict) else [],
                key_result_changes,
            )
        return await runtime.request(
            ctx,
            "PATCH",
            api.workspace_path(f"/objectives/{objective_ref}"),
            body=updates,
        )

    @mcp.tool(name="knotwork_project_update")
    async def knotwork_project_update(
        project_ref: str,
        status: str | None = None,
        title: str | None = None,
        description: str | None = None,
        status_update_summary: str | None = None,
        affected_objective_refs: list[str] | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        updates: dict[str, Any] = {}
        if status is not None:
            updates["status"] = status
        if title is not None:
            updates["title"] = title
        if description is not None:
            updates["description"] = description
        updated_project = None
        if updates:
            updated_project = await runtime.request(
                ctx,
                "PATCH",
                api.workspace_path(f"/projects/{project_ref}"),
                body=updates,
            )
        else:
            updated_project = await runtime.request(ctx, "GET", api.workspace_path(f"/projects/{project_ref}"))

        status_update = None
        if status_update_summary:
            summary = status_update_summary.strip()
            if affected_objective_refs:
                joined = ", ".join(str(item).strip() for item in affected_objective_refs if str(item).strip())
                if joined:
                    summary = f"{summary}\n\nAffected objectives: {joined}"
            status_update = await runtime.request(
                ctx,
                "POST",
                api.workspace_path(f"/projects/{project_ref}/status-updates"),
                body={
                    "summary": summary,
                    "author_type": "agent",
                },
            )
        return {
            "project": updated_project,
            "status_update": status_update,
            "affected_objective_refs": affected_objective_refs or [],
        }

from __future__ import annotations

from typing import Any

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    async def _list_members(
        ctx: Context | None,
        *,
        kind: str | None = None,
        disabled: bool | None = None,
    ) -> dict[str, Any]:
        api = runtime.client_from_context(ctx)
        params: dict[str, Any] = {"page_size": 100}
        if kind:
            params["kind"] = kind
        if disabled is not None:
            params["disabled"] = disabled
        payload = await runtime.request(ctx, "GET", api.workspace_path("/members"), params=params)
        return payload if isinstance(payload, dict) else {"items": payload}

    async def _current_member(ctx: Context | None) -> dict[str, Any]:
        access_token = get_access_token()
        if access_token is None:
            raise RuntimeError("Missing bearer token in MCP request")
        members = await _list_members(ctx, disabled=False)
        items = members.get("items", [])
        for member in items:
            if not isinstance(member, dict):
                continue
            if str(member.get("user_id")) != access_token.client_id:
                continue
            member_id = str(member.get("id"))
            user_id = str(member.get("user_id"))
            kind = str(member.get("kind") or "")
            participant_id = (
                f"agent:{member_id}"
                if kind == "agent"
                else f"human:{user_id}"
                if kind == "human"
                else member_id
            )
            return {**member, "participant_id": participant_id}
        raise RuntimeError("Current bearer token is not a member of this workspace")

    @mcp.resource(
        "knotwork://admin/members",
        name="admin_members",
        title="Workspace Members",
        description="Active workspace members with their status, role, and participation metadata.",
        mime_type="application/json",
    )
    async def members_resource() -> str:
        return runtime.json_text(await _list_members(mcp.get_context(), disabled=False))

    @mcp.resource(
        "knotwork://admin/members/agents",
        name="admin_agent_members",
        title="Agent Members",
        description="Active agent members registered in this workspace.",
        mime_type="application/json",
    )
    async def agent_members_resource() -> str:
        return runtime.json_text(await _list_members(mcp.get_context(), kind="agent", disabled=False))

    @mcp.resource(
        "knotwork://admin/members/{member_id}",
        name="admin_member_detail",
        title="Member Detail",
        description="Full workspace member profile for one member id.",
        mime_type="application/json",
    )
    async def member_resource(member_id: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/members/{member_id}")))

    @mcp.resource(
        "knotwork://admin/members/current",
        name="admin_current_member",
        title="Current Member",
        description="Self-profile bootstrap for the current actor in this workspace.",
        mime_type="application/json",
    )
    async def current_member_resource() -> str:
        return runtime.json_text(await _current_member(mcp.get_context()))

    @mcp.resource(
        "knotwork://admin/capacity-board",
        name="admin_capacity_board",
        title="Capacity Board",
        description="Contribution briefs, availability, capacity, commitments, and recent work across active members.",
        mime_type="application/json",
    )
    async def capacity_board_resource() -> str:
        members = await _list_members(mcp.get_context(), disabled=False)
        items = members.get("items", []) if isinstance(members, dict) else []
        board = [
            {
                "member_id": item.get("id"),
                "name": item.get("name"),
                "kind": item.get("kind"),
                "role": item.get("role"),
                "contribution_brief": item.get("contribution_brief"),
                "availability_status": item.get("availability_status"),
                "capacity_level": item.get("capacity_level"),
                "status_note": item.get("status_note"),
                "current_commitments": item.get("current_commitments") or [],
                "recent_work": item.get("recent_work") or [],
                "status_updated_at": item.get("status_updated_at"),
            }
            for item in items
            if isinstance(item, dict)
        ]
        return runtime.json_text({"items": board})

    @mcp.resource(
        "knotwork://admin/workspace/policies",
        name="admin_workspace_policies",
        title="Workspace Policies",
        description="Workspace-level operating guidance for this workspace when it exists.",
        mime_type="text/markdown",
    )
    async def workspace_policies_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        guide = await runtime.request(mcp.get_context(), "GET", api.workspace_path("/guide"))
        if isinstance(guide, dict) and isinstance(guide.get("guide_md"), str):
            return guide["guide_md"] or "# Workspace Policies\n\nNo workspace guide is currently set."
        return "# Workspace Policies\n\nNo workspace guide is currently set."

    @mcp.prompt(
        name="admin.update_my_status",
        title="Update My Status",
        description="Guidance for updating your own member availability, capacity, and commitments.",
    )
    def update_my_status_prompt() -> str:
        return (
            "Update only your own current status.\n"
            "Capture availability, capacity, current commitments, recent work, and any short status note.\n"
            "Prefer concrete signals over narrative.\n"
            "Stay scoped to status and coordination context, not broader business-task routing."
        )

    @mcp.prompt(
        name="admin.choose_member_for_task",
        title="Choose Member For Task",
        description="Guidance for selecting the right active member for a task.",
    )
    def choose_member_for_task_prompt(task_summary: str) -> str:
        return (
            f"Choose the best active member for this task: {task_summary}\n"
            "Use active members only.\n"
            "Weight contribution brief, availability, capacity, and recent work before routing the task.\n"
            "Prefer the smallest viable handoff."
        )

    @mcp.prompt(
        name="admin.summarize_team_capacity",
        title="Summarize Team Capacity",
        description="Guidance for summarizing current workspace capacity and constraints.",
    )
    def summarize_team_capacity_prompt() -> str:
        return (
            "Summarize current team capacity from active members only.\n"
            "Call out who is available, who is constrained, and any obvious overload or gaps.\n"
            "Keep the summary operational rather than motivational."
        )

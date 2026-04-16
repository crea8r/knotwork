from __future__ import annotations

from typing import Any

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    @mcp.tool()
    async def list_members(
        kind: str | None = None,
        disabled: bool | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        params: dict[str, Any] = {}
        if kind:
            params["kind"] = kind
        if disabled is not None:
            params["disabled"] = disabled
        return await runtime.request(ctx, "GET", api.workspace_path("/members"), params=params or None)

    @mcp.tool()
    async def list_agent_members(q: str | None = None, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        params: dict[str, Any] = {"kind": "agent"}
        if q:
            params["q"] = q
        return await runtime.request(ctx, "GET", api.workspace_path("/members"), params=params)

    @mcp.tool()
    async def get_member(member_id: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path(f"/members/{member_id}"))

    @mcp.tool()
    async def get_current_member(ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        access_token = get_access_token()
        if access_token is None:
            raise RuntimeError("Missing bearer token in MCP request")
        members = await runtime.request(
            ctx,
            "GET",
            api.workspace_path("/members"),
            params={"page_size": 100},
        )
        items = members.get("items", []) if isinstance(members, dict) else []
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
            return {
                **member,
                "participant_id": participant_id,
            }
        raise RuntimeError("Current bearer token is not a member of this workspace")

    @mcp.tool()
    async def update_member_profile(
        member_id: str,
        contribution_brief: str | None = None,
        availability_status: str | None = None,
        capacity_level: str | None = None,
        status_note: str | None = None,
        current_commitments: list[dict[str, Any]] | None = None,
        recent_work: list[dict[str, Any]] | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        body: dict[str, Any] = {}
        if contribution_brief is not None:
            body["contribution_brief"] = contribution_brief
        if availability_status is not None:
            body["availability_status"] = availability_status
        if capacity_level is not None:
            body["capacity_level"] = capacity_level
        if status_note is not None:
            body["status_note"] = status_note
        if current_commitments is not None:
            body["current_commitments"] = current_commitments
        if recent_work is not None:
            body["recent_work"] = recent_work
        if not body:
            raise RuntimeError("No member profile update provided")
        return await runtime.request(
            ctx,
            "PATCH",
            api.workspace_path(f"/members/{member_id}"),
            body=body,
        )

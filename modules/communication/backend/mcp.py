from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    @mcp.resource(
        "knotwork://escalations/open",
        name="open_escalations",
        title="Open Escalations",
        description="All open escalations for the configured workspace.",
        mime_type="application/json",
    )
    async def open_escalations_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        escalations = await runtime.request(
            mcp.get_context(),
            "GET",
            api.workspace_path("/escalations"),
            params={"status": "open"},
        )
        return runtime.json_text(escalations)

    @mcp.resource(
        "knotwork://inbox/summary",
        name="inbox_summary",
        title="Inbox Summary",
        description="Unread, active, and archived inbox counts for the current bearer token.",
        mime_type="application/json",
    )
    async def inbox_summary_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        summary = await runtime.request(
            mcp.get_context(),
            "GET",
            api.workspace_path("/inbox/summary"),
        )
        return runtime.json_text(summary)

    @mcp.tool()
    async def list_escalations(status: str | None = None, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        params = {"status": status} if status else None
        return await runtime.request(ctx, "GET", api.workspace_path("/escalations"), params=params)

    @mcp.tool()
    async def get_escalation(escalation_id: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path(f"/escalations/{escalation_id}"))

    @mcp.tool()
    async def resolve_escalation(
        escalation_id: str,
        resolution: str,
        actor_name: str,
        actor_type: str | None = None,
        guidance: str | None = None,
        override_output: dict[str, Any] | None = None,
        next_branch: str | None = None,
        answers: list[str] | None = None,
        channel_id: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path(f"/escalations/{escalation_id}/resolve"),
            body={
                "resolution": resolution,
                "actor_name": actor_name,
                "actor_type": actor_type,
                "guidance": guidance,
                "override_output": override_output,
                "next_branch": next_branch,
                "answers": answers,
                "channel_id": channel_id,
            },
        )

    @mcp.tool()
    async def respond_channel_message(
        channel_ref: str,
        message_id: str,
        resolution: str,
        actor_name: str,
        actor_type: str | None = None,
        guidance: str | None = None,
        override_output: dict[str, Any] | None = None,
        next_branch: str | None = None,
        answers: list[str] | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path(f"/channels/{channel_ref}/messages/{message_id}/respond"),
            body={
                "resolution": resolution,
                "actor_name": actor_name,
                "actor_type": actor_type,
                "guidance": guidance,
                "override_output": override_output,
                "next_branch": next_branch,
                "answers": answers,
            },
        )

    @mcp.tool()
    async def list_participants(ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path("/participants"))

    @mcp.tool()
    async def list_channels(ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path("/channels"))

    @mcp.tool()
    async def get_channel(channel_ref: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_ref}"))

    @mcp.tool()
    async def list_channel_messages(channel_ref: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path(f"/channels/{channel_ref}/messages"),
        )

    @mcp.tool()
    async def list_channel_participants(channel_ref: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path(f"/channels/{channel_ref}/participants"),
        )

    @mcp.tool()
    async def list_channel_assets(channel_ref: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path(f"/channels/{channel_ref}/assets"),
        )

    @mcp.tool()
    async def list_my_channel_subscriptions(ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path("/channels/subscriptions/me"),
        )

    @mcp.tool()
    async def post_channel_message(
        channel_ref: str,
        content: str,
        role: str = "user",
        author_type: str = "human",
        author_name: str | None = None,
        run_id: str | None = None,
        node_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "POST",
            api.workspace_path(f"/channels/{channel_ref}/messages"),
            body={
                "role": role,
                "author_type": author_type,
                "author_name": author_name,
                "content": content,
                "run_id": run_id,
                "node_id": node_id,
                "metadata": metadata or {},
            },
        )

    @mcp.tool()
    async def list_channel_decisions(channel_ref: str, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path(f"/channels/{channel_ref}/decisions"),
        )

    @mcp.tool()
    async def get_inbox(archived: bool = False, ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path("/inbox"),
            params={"archived": archived},
        )

    @mcp.tool()
    async def get_inbox_summary(ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path("/inbox/summary"))

    @mcp.tool()
    async def mark_all_inbox_read(ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "POST", api.workspace_path("/inbox/read-all"))

    @mcp.tool()
    async def update_inbox_delivery(
        delivery_id: str,
        read: bool | None = None,
        archived: bool | None = None,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "PATCH",
            api.workspace_path(f"/inbox/deliveries/{delivery_id}"),
            body={"read": read, "archived": archived},
        )

    @mcp.tool()
    async def get_notification_preferences(ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path("/notification-preferences"),
        )

    @mcp.tool()
    async def update_notification_preferences(
        updates: dict[str, Any],
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "PATCH",
            api.workspace_path("/notification-preferences"),
            body=updates,
        )

    @mcp.tool()
    async def get_notification_log(ctx: Context = None) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(ctx, "GET", api.workspace_path("/notification-log"))

    @mcp.tool()
    async def get_participant_delivery_preferences(
        participant_id: str,
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "GET",
            api.workspace_path(f"/participants/{participant_id}/delivery-preferences"),
        )

    @mcp.tool()
    async def update_participant_delivery_preference(
        participant_id: str,
        event_type: str,
        updates: dict[str, Any],
        ctx: Context = None,
    ) -> Any:
        api = runtime.client_from_context(ctx)
        return await runtime.request(
            ctx,
            "PATCH",
            api.workspace_path(
                f"/participants/{participant_id}/delivery-preferences/{event_type}"
            ),
            body=updates,
        )

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import Context, FastMCP

from core.mcp.runtime import KnotworkMCPRuntime


def register_mcp_tools(mcp: FastMCP, runtime: KnotworkMCPRuntime) -> None:
    async def _post_message(
        ctx: Context | None,
        *,
        channel_ref: str,
        content: str,
        role: str = "assistant",
        author_type: str = "agent",
        author_name: str | None = None,
        run_id: str | None = None,
        node_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
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

    @mcp.resource(
        "knotwork://communication/inbox/summary",
        name="communication_inbox_summary",
        title="Communication Inbox Summary",
        description="Unread, active, and archived inbox counts for the current actor.",
        mime_type="application/json",
    )
    async def communication_inbox_summary_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        return runtime.json_text(await runtime.request(mcp.get_context(), "GET", api.workspace_path("/inbox/summary")))

    @mcp.resource(
        "knotwork://communication/inbox/open",
        name="communication_inbox_open",
        title="Open Inbox",
        description="Open inbox items for the current actor.",
        mime_type="application/json",
    )
    async def communication_inbox_open_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        return runtime.json_text(
            await runtime.request(
                mcp.get_context(),
                "GET",
                api.workspace_path("/inbox"),
                params={"archived": False},
            )
        )

    @mcp.resource(
        "knotwork://communication/channel/{channel_ref}",
        name="communication_channel",
        title="Channel Detail",
        description="Full channel detail for a channel ref.",
        mime_type="application/json",
    )
    async def channel_resource(channel_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_ref}")))

    @mcp.resource(
        "knotwork://communication/channel/{channel_ref}/messages",
        name="communication_channel_messages",
        title="Channel Messages",
        description="Messages in a channel.",
        mime_type="application/json",
    )
    async def channel_messages_resource(channel_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_ref}/messages")))

    @mcp.resource(
        "knotwork://communication/channel/{channel_ref}/participants",
        name="communication_channel_participants",
        title="Channel Participants",
        description="Participants subscribed to a channel.",
        mime_type="application/json",
    )
    async def channel_participants_resource(channel_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(
            await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_ref}/participants"))
        )

    @mcp.resource(
        "knotwork://communication/channel/{channel_ref}/assets",
        name="communication_channel_assets",
        title="Channel Assets",
        description="Asset bindings attached to a channel.",
        mime_type="application/json",
    )
    async def channel_assets_resource(channel_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_ref}/assets")))

    @mcp.resource(
        "knotwork://communication/channel/{channel_ref}/bound-assets",
        name="communication_channel_bound_assets",
        title="Bound Assets",
        description="Compact asset bindings attached to a channel.",
        mime_type="application/json",
    )
    async def channel_bound_assets_resource(channel_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        payload = await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_ref}/assets"))
        rows = payload if isinstance(payload, list) else []
        compact = [
            {
                "binding_id": row.get("id"),
                "asset_id": row.get("asset_id"),
                "asset_type": row.get("asset_type"),
                "display_name": row.get("display_name"),
                "path": row.get("path"),
            }
            for row in rows
            if isinstance(row, dict)
        ]
        return runtime.json_text(compact)

    @mcp.resource(
        "knotwork://communication/channel/{channel_ref}/decisions",
        name="communication_channel_decisions",
        title="Channel Decisions",
        description="Decision events logged for a channel.",
        mime_type="application/json",
    )
    async def channel_decisions_resource(channel_ref: str, ctx: Context = None) -> str:
        api = runtime.client_from_context(ctx)
        return runtime.json_text(
            await runtime.request(ctx, "GET", api.workspace_path(f"/channels/{channel_ref}/decisions"))
        )

    @mcp.resource(
        "knotwork://communication/notification-preferences",
        name="communication_notification_preferences",
        title="Notification Preferences",
        description="Workspace notification preferences for the current workspace.",
        mime_type="application/json",
    )
    async def notification_preferences_resource() -> str:
        api = runtime.client_from_context(mcp.get_context())
        return runtime.json_text(
            await runtime.request(mcp.get_context(), "GET", api.workspace_path("/notification-preferences"))
        )

    @mcp.prompt(
        name="communication.reply_to_channel",
        title="Reply To Channel",
        description="Guidance for replying to a non-run channel.",
    )
    def reply_to_channel_prompt() -> str:
        return (
            "Reply only to the immediate non-run channel need.\n"
            "Prefer a direct answer or the smallest clarifying question.\n"
            "Use `knotwork_channel_post_message` for the actual reply."
        )

    @mcp.prompt(
        name="communication.triage_inbox_delivery",
        title="Triage Inbox Delivery",
        description="Guidance for triaging inbox items.",
    )
    def triage_inbox_delivery_prompt() -> str:
        return (
            "Triage inbox items by urgency, response requirement, and whether they belong to another domain module.\n"
            "Do not treat every inbox item as a communication-only task."
        )

    @mcp.prompt(
        name="communication.ask_clarifying_question",
        title="Ask Clarifying Question",
        description="Guidance for asking the smallest useful clarifying question.",
    )
    def ask_clarifying_question_prompt() -> str:
        return (
            "Ask one concrete clarifying question when the next action would otherwise be guesswork.\n"
            "Keep it narrow and easy to answer in-channel."
        )

    @mcp.prompt(
        name="communication.summarize_channel_state",
        title="Summarize Channel State",
        description="Guidance for summarizing current channel state.",
    )
    def summarize_channel_state_prompt() -> str:
        return (
            "Summarize the active channel state: current ask, open blockers, recent decisions, and next obvious action."
        )

    @mcp.tool(name="knotwork_channel_post_message")
    async def knotwork_channel_post_message(
        channel_ref: str,
        content: str,
        reply_to_message_id: str | None = None,
        author_name: str | None = None,
        metadata: dict[str, Any] | None = None,
        ctx: Context = None,
    ) -> Any:
        payload_metadata = dict(metadata or {})
        if reply_to_message_id:
            payload_metadata["reply_to_message_id"] = reply_to_message_id
        return await _post_message(
            ctx,
            channel_ref=channel_ref,
            content=content,
            author_name=author_name,
            metadata=payload_metadata,
        )

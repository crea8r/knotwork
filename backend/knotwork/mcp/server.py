from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from knotwork.mcp.client import KnotworkAPIClient, KnotworkMCPSettings


def _json_text(payload: Any) -> str:
    return json.dumps(payload, indent=2, sort_keys=True)


def build_server(client: KnotworkAPIClient | None = None) -> FastMCP:
    api = client or KnotworkAPIClient(KnotworkMCPSettings.from_env())
    workspace_id = api.workspace_id

    mcp = FastMCP(
        name="Knotwork",
        instructions=(
            "Operate a Knotwork workspace through its HTTP API. "
            "Use read tools and resources first for context, then mutate state through the "
            "domain tools for runs, escalations, objectives, channels, inbox, knowledge, "
            "notifications, and registered agents."
        ),
        json_response=True,
    )

    async def _request(
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        return await api.request(method, path, params=params, json_body=body)

    @mcp.resource(
        "knotwork://workspace/overview",
        name="workspace_overview",
        title="Workspace Overview",
        description="High-level operational snapshot for the configured Knotwork workspace.",
        mime_type="application/json",
    )
    async def workspace_overview_resource() -> str:
        return _json_text(await get_workspace_overview())

    @mcp.resource(
        "knotwork://runs/active",
        name="active_runs",
        title="Active Runs",
        description="All non-terminal runs for the configured workspace.",
        mime_type="application/json",
    )
    async def active_runs_resource() -> str:
        return _json_text(await list_runs(status="active"))

    @mcp.resource(
        "knotwork://escalations/open",
        name="open_escalations",
        title="Open Escalations",
        description="All open escalations for the configured workspace.",
        mime_type="application/json",
    )
    async def open_escalations_resource() -> str:
        return _json_text(await list_escalations(status="open"))

    @mcp.resource(
        "knotwork://inbox/summary",
        name="inbox_summary",
        title="Inbox Summary",
        description="Unread, active, and archived inbox counts for the current bearer token.",
        mime_type="application/json",
    )
    async def inbox_summary_resource() -> str:
        return _json_text(await get_inbox_summary())

    @mcp.resource(
        "knotwork://workspace/skills",
        name="workspace_skills",
        title="Agent Skills",
        description=(
            "Behavioral context for this workspace — how to authenticate, "
            "available MCP tools, handbook overview, and active channels. "
            "Fetch this on startup to bootstrap workspace context."
        ),
        mime_type="text/markdown",
    )
    async def workspace_skills_resource() -> str:
        result = await _request("GET", api.workspace_path("/skills"))
        # Client returns {"text": "..."} for non-JSON responses
        if isinstance(result, dict) and "text" in result:
            return result["text"]
        return str(result)

    @mcp.tool()
    async def get_workspace_overview() -> dict[str, Any]:
        runs = await _request("GET", api.workspace_path("/runs"))
        escalations = await _request(
            "GET",
            api.workspace_path("/escalations"),
            params={"status": "open"},
        )
        inbox_summary = await _request("GET", api.workspace_path("/inbox/summary"))
        participants = await _request("GET", api.workspace_path("/participants"))
        agents = await _request("GET", api.workspace_path("/members"), params={"kind": "agent"})
        health = await _request("GET", "/health")

        active_runs = [
            run for run in runs if run.get("status") not in {"completed", "failed", "stopped"}
        ]
        return {
            "workspace_id": workspace_id,
            "health": health,
            "active_runs": active_runs,
            "open_escalations": escalations,
            "inbox_summary": inbox_summary,
            "participants": participants,
            "agent_members": agents,
        }

    @mcp.tool()
    async def list_graphs(project_id: str | None = None) -> Any:
        params = {"project_id": project_id} if project_id else None
        return await _request("GET", api.workspace_path("/graphs"), params=params)

    @mcp.tool()
    async def create_graph(
        name: str,
        description: str | None = None,
        path: str = "",
        default_model: str | None = None,
        project_id: str | None = None,
        definition: dict[str, Any] | None = None,
    ) -> Any:
        return await _request(
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
    async def get_graph(graph_id: str) -> Any:
        return await _request("GET", api.workspace_path(f"/graphs/{graph_id}"))

    @mcp.tool()
    async def list_runs(status: str | None = None) -> Any:
        runs = await _request("GET", api.workspace_path("/runs"))
        if not status:
            return runs
        terminal = {"completed", "failed", "stopped"}
        if status == "active":
            return [run for run in runs if run.get("status") not in terminal]
        return [run for run in runs if run.get("status") == status]

    @mcp.tool()
    async def get_run(run_id: str) -> Any:
        return await _request("GET", api.workspace_path(f"/runs/{run_id}"))

    @mcp.tool()
    async def list_run_nodes(run_id: str) -> Any:
        return await _request("GET", api.workspace_path(f"/runs/{run_id}/nodes"))

    @mcp.tool()
    async def trigger_run(
        graph_id: str,
        name: str | None = None,
        input: dict[str, Any] | None = None,
        graph_version_id: str | None = None,
        objective_id: str | None = None,
        source_channel_id: str | None = None,
    ) -> Any:
        body: dict[str, Any] = {
            "name": name,
            "input": input or {},
            "graph_version_id": graph_version_id,
            "objective_id": objective_id,
            "source_channel_id": source_channel_id,
            "trigger": "manual",
            "context_files": [],
        }
        return await _request(
            "POST",
            api.workspace_path(f"/graphs/{graph_id}/runs"),
            body=body,
        )

    @mcp.tool()
    async def abort_run(run_id: str) -> Any:
        return await _request("POST", api.workspace_path(f"/runs/{run_id}/abort"))

    @mcp.tool()
    async def list_escalations(status: str | None = None) -> Any:
        params = {"status": status} if status else None
        return await _request("GET", api.workspace_path("/escalations"), params=params)

    @mcp.tool()
    async def get_escalation(escalation_id: str) -> Any:
        return await _request("GET", api.workspace_path(f"/escalations/{escalation_id}"))

    @mcp.tool()
    async def resolve_escalation(
        escalation_id: str,
        resolution: str,
        actor_name: str,
        guidance: str | None = None,
        override_output: dict[str, Any] | None = None,
        next_branch: str | None = None,
        answers: list[str] | None = None,
        channel_id: str | None = None,
    ) -> Any:
        body = {
            "resolution": resolution,
            "actor_name": actor_name,
            "guidance": guidance,
            "override_output": override_output,
            "next_branch": next_branch,
            "answers": answers,
            "channel_id": channel_id,
        }
        return await _request(
            "POST",
            api.workspace_path(f"/escalations/{escalation_id}/resolve"),
            body=body,
        )

    @mcp.tool()
    async def list_projects() -> Any:
        return await _request("GET", api.workspace_path("/projects"))

    @mcp.tool()
    async def create_project(
        title: str,
        description: str,
        status: str = "open",
        deadline: str | None = None,
    ) -> Any:
        return await _request(
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
    async def get_project(project_ref: str) -> Any:
        return await _request("GET", api.workspace_path(f"/projects/{project_ref}"))

    @mcp.tool()
    async def update_project(project_ref: str, updates: dict[str, Any]) -> Any:
        return await _request(
            "PATCH",
            api.workspace_path(f"/projects/{project_ref}"),
            body=updates,
        )

    @mcp.tool()
    async def get_project_dashboard(project_ref: str) -> Any:
        return await _request(
            "GET",
            api.workspace_path(f"/projects/{project_ref}/dashboard"),
        )

    @mcp.tool()
    async def list_objectives(project_id: str | None = None) -> Any:
        params = {"project_id": project_id} if project_id else None
        return await _request("GET", api.workspace_path("/objectives"), params=params)

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
    ) -> Any:
        body = {
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
        }
        return await _request("POST", api.workspace_path("/objectives"), body=body)

    @mcp.tool()
    async def get_objective(objective_ref: str) -> Any:
        return await _request("GET", api.workspace_path(f"/objectives/{objective_ref}"))

    @mcp.tool()
    async def update_objective(objective_ref: str, updates: dict[str, Any]) -> Any:
        return await _request(
            "PATCH",
            api.workspace_path(f"/objectives/{objective_ref}"),
            body=updates,
        )

    @mcp.tool()
    async def list_project_channels(project_ref: str, include_archived: bool = False) -> Any:
        return await _request(
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
    ) -> Any:
        return await _request(
            "POST",
            api.workspace_path(f"/projects/{project_ref}/status-updates"),
            body={
                "summary": summary,
                "author_type": author_type,
                "author_name": author_name,
            },
        )

    @mcp.tool()
    async def list_knowledge_files() -> Any:
        return await _request("GET", api.workspace_path("/knowledge"))

    @mcp.tool()
    async def read_knowledge_file(path: str) -> Any:
        return await _request(
            "GET",
            api.workspace_path("/knowledge/file"),
            params={"path": path},
        )

    @mcp.tool()
    async def create_knowledge_file(
        path: str,
        title: str,
        content: str,
        change_summary: str | None = None,
    ) -> Any:
        return await _request(
            "POST",
            api.workspace_path("/knowledge"),
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
    ) -> Any:
        return await _request(
            "PUT",
            api.workspace_path("/knowledge/file"),
            params={"path": path},
            body={"content": content, "change_summary": change_summary},
        )

    @mcp.tool()
    async def list_knowledge_changes(status: str | None = None) -> Any:
        params = {"status": status} if status else None
        return await _request(
            "GET",
            api.workspace_path("/knowledge/changes"),
            params=params,
        )

    @mcp.tool()
    async def create_knowledge_change(
        path: str,
        proposed_content: str,
        reason: str,
        run_id: str = "manual",
        node_id: str = "knowledge-review",
        agent_ref: str | None = None,
        source_channel_id: str | None = None,
    ) -> Any:
        return await _request(
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
    ) -> Any:
        return await _request(
            "POST",
            api.workspace_path(f"/knowledge/changes/{proposal_id}/approve"),
            body={"final_content": final_content},
        )

    @mcp.tool()
    async def reject_knowledge_change(proposal_id: str) -> Any:
        return await _request(
            "POST",
            api.workspace_path(f"/knowledge/changes/{proposal_id}/reject"),
            body={},
        )

    @mcp.tool()
    async def list_handbook_proposals(status: str | None = None) -> Any:
        return await list_knowledge_changes(status=status)

    @mcp.tool()
    async def list_participants() -> Any:
        return await _request("GET", api.workspace_path("/participants"))

    @mcp.tool()
    async def list_channels() -> Any:
        return await _request("GET", api.workspace_path("/channels"))

    @mcp.tool()
    async def get_channel(channel_ref: str) -> Any:
        return await _request("GET", api.workspace_path(f"/channels/{channel_ref}"))

    @mcp.tool()
    async def list_channel_messages(channel_ref: str) -> Any:
        return await _request(
            "GET",
            api.workspace_path(f"/channels/{channel_ref}/messages"),
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
    ) -> Any:
        return await _request(
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
    async def list_channel_decisions(channel_ref: str) -> Any:
        return await _request(
            "GET",
            api.workspace_path(f"/channels/{channel_ref}/decisions"),
        )

    @mcp.tool()
    async def get_inbox(archived: bool = False) -> Any:
        return await _request(
            "GET",
            api.workspace_path("/inbox"),
            params={"archived": archived},
        )

    @mcp.tool()
    async def get_inbox_summary() -> Any:
        return await _request("GET", api.workspace_path("/inbox/summary"))

    @mcp.tool()
    async def mark_all_inbox_read() -> Any:
        return await _request("POST", api.workspace_path("/inbox/read-all"))

    @mcp.tool()
    async def update_inbox_delivery(
        delivery_id: str,
        read: bool | None = None,
        archived: bool | None = None,
    ) -> Any:
        return await _request(
            "PATCH",
            api.workspace_path(f"/inbox/deliveries/{delivery_id}"),
            body={"read": read, "archived": archived},
        )

    @mcp.tool()
    async def get_notification_preferences() -> Any:
        return await _request(
            "GET",
            api.workspace_path("/notification-preferences"),
        )

    @mcp.tool()
    async def update_notification_preferences(updates: dict[str, Any]) -> Any:
        return await _request(
            "PATCH",
            api.workspace_path("/notification-preferences"),
            body=updates,
        )

    @mcp.tool()
    async def get_notification_log() -> Any:
        return await _request("GET", api.workspace_path("/notification-log"))

    @mcp.tool()
    async def get_participant_delivery_preferences(participant_id: str) -> Any:
        return await _request(
            "GET",
            api.workspace_path(f"/participants/{participant_id}/delivery-preferences"),
        )

    @mcp.tool()
    async def update_participant_delivery_preference(
        participant_id: str,
        event_type: str,
        updates: dict[str, Any],
    ) -> Any:
        return await _request(
            "PATCH",
            api.workspace_path(
                f"/participants/{participant_id}/delivery-preferences/{event_type}"
            ),
            body=updates,
        )

    @mcp.tool()
    async def list_agent_members(q: str | None = None) -> Any:
        """List workspace members with kind='agent'."""
        params: dict[str, Any] = {"kind": "agent"}
        if q:
            params["q"] = q
        return await _request("GET", api.workspace_path("/members"), params=params)

    @mcp.tool()
    async def get_member(member_id: str) -> Any:
        """Get a workspace member (human or agent) by ID."""
        return await _request("GET", api.workspace_path(f"/members/{member_id}"))

    return mcp

if __name__ == "__main__":
    build_server().run()

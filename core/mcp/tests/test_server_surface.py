from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.mcp.server import KnotworkAPIClient, build_server


@pytest.mark.asyncio
async def test_server_registers_public_module_mcp_surface() -> None:
    server = build_server(
        client=KnotworkAPIClient(
            api_url="http://example.test",
            bearer_token="token",
            workspace_id="workspace-1",
        )
    )

    resource_uris = {str(resource.uri) for resource in await server.list_resources()}
    template_uris = {str(resource.uriTemplate) for resource in await server.list_resource_templates()}
    tool_names = {tool.name for tool in await server.list_tools()}
    prompt_names = {prompt.name for prompt in await server.list_prompts()}

    assert "knotwork://workspace/bootstrap" in resource_uris
    assert "knotwork://workspace/capabilities" in resource_uris
    assert "knotwork://admin/members/current" in resource_uris
    assert "knotwork://assets/workspace/catalog" in resource_uris
    assert "knotwork://communication/inbox/summary" in resource_uris
    assert "knotwork://projects/list" in resource_uris
    assert "knotwork://workflows/catalog" in resource_uris

    assert "knotwork://admin/members/{member_id}" in template_uris
    assert "knotwork://assets/project/{project_id}/file/{path}" in template_uris
    assert "knotwork://communication/channel/{channel_ref}/messages" in template_uris
    assert "knotwork://projects/objective/{objective_ref}/children" in template_uris
    assert "knotwork://workflows/request/{message_id}" in template_uris

    assert "knotwork_asset_search" in tool_names
    assert "knotwork_asset_read" in tool_names
    assert "knotwork_asset_change" in tool_names
    assert "knotwork_channel_post_message" in tool_names
    assert "knotwork_objective_update" in tool_names
    assert "knotwork_project_update" in tool_names
    assert "knotwork_run_operator_complete" in tool_names
    assert "knotwork_run_operator_escalate" in tool_names
    assert "knotwork_run_supervisor_resolve_escalation" in tool_names
    assert "knotwork_workflow_edit" in tool_names

    assert "list_members" not in tool_names
    assert "list_agent_members" not in tool_names
    assert "get_member" not in tool_names
    assert "get_current_member" not in tool_names
    assert "update_member_profile" not in tool_names
    assert "list_knowledge_files" not in tool_names
    assert "read_knowledge_file" not in tool_names
    assert "create_knowledge_file" not in tool_names
    assert "update_knowledge_file" not in tool_names
    assert "list_knowledge_changes" not in tool_names
    assert "create_knowledge_change" not in tool_names
    assert "approve_knowledge_change" not in tool_names
    assert "reject_knowledge_change" not in tool_names
    assert "respond_channel_message" not in tool_names
    assert "list_participants" not in tool_names
    assert "list_channels" not in tool_names
    assert "get_channel" not in tool_names
    assert "list_channel_messages" not in tool_names
    assert "list_channel_participants" not in tool_names
    assert "list_channel_assets" not in tool_names
    assert "list_my_channel_subscriptions" not in tool_names
    assert "post_channel_message" not in tool_names
    assert "list_channel_decisions" not in tool_names
    assert "get_inbox" not in tool_names
    assert "get_inbox_summary" not in tool_names
    assert "mark_all_inbox_read" not in tool_names
    assert "update_inbox_delivery" not in tool_names
    assert "get_notification_preferences" not in tool_names
    assert "update_notification_preferences" not in tool_names
    assert "get_notification_log" not in tool_names
    assert "get_participant_delivery_preferences" not in tool_names
    assert "update_participant_delivery_preference" not in tool_names
    assert "list_projects" not in tool_names
    assert "create_project" not in tool_names
    assert "get_project" not in tool_names
    assert "update_project" not in tool_names
    assert "get_project_dashboard" not in tool_names
    assert "list_objectives" not in tool_names
    assert "create_objective" not in tool_names
    assert "get_objective" not in tool_names
    assert "get_objective_chain" not in tool_names
    assert "update_objective" not in tool_names
    assert "list_project_channels" not in tool_names
    assert "create_project_status_update" not in tool_names
    assert "list_graphs" not in tool_names
    assert "create_graph" not in tool_names
    assert "get_graph" not in tool_names
    assert "get_graph_by_path" not in tool_names
    assert "get_graph_root_draft" not in tool_names
    assert "update_graph_root_draft" not in tool_names
    assert "list_runs" not in tool_names
    assert "get_run" not in tool_names
    assert "list_escalations" not in tool_names
    assert "list_run_escalations" not in tool_names
    assert "get_escalation" not in tool_names
    assert "resolve_escalation" not in tool_names
    assert "list_run_nodes" not in tool_names
    assert "trigger_run" not in tool_names
    assert "abort_run" not in tool_names

    assert "admin.update_my_status" in prompt_names
    assert "assets.propose_asset_change" in prompt_names
    assert "communication.reply_to_channel" in prompt_names
    assert "projects.summarize_project_health" in prompt_names
    assert "run.operator.respond_to_request" in prompt_names
    assert "run.supervisor.review_escalation" in prompt_names
    assert "workflow.edit" in prompt_names

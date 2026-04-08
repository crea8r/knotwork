from __future__ import annotations

import json
from copy import deepcopy

import pytest

import knotwork.mcp.server as mcp_server
from knotwork.mcp.server import build_server


class FakeAPIClient:
    def __init__(self, responses: dict[tuple[str, str], object], workspace_id: str = "ws-test"):
        self.responses = responses
        self.workspace_id = workspace_id
        self.calls: list[dict] = []

    async def request(self, method: str, path: str, *, params=None, json_body=None):
        self.calls.append(
            {
                "method": method,
                "path": path,
                "params": params,
                "json_body": json_body,
            }
        )
        key = (method.upper(), path)
        if key not in self.responses:
            raise AssertionError(f"Unexpected request: {key}")
        return deepcopy(self.responses[key])

    def workspace_path(self, suffix: str) -> str:
        suffix = suffix if suffix.startswith("/") else f"/{suffix}"
        return f"/api/v1/workspaces/{self.workspace_id}{suffix}"


def _tool_json(result):
    assert result
    if isinstance(result, tuple):
        _, structured = result
        return structured
    return json.loads(result[0].text)


def _tool_json_items(result):
    assert result
    if isinstance(result, tuple):
        _, structured = result
        return structured
    return [json.loads(item.text) for item in result]


@pytest.mark.asyncio
async def test_get_workspace_overview_aggregates_operational_state():
    client = FakeAPIClient(
        {
            ("GET", "/api/v1/workspaces/ws-test/runs"): [
                {"id": "run-active", "status": "paused"},
                {"id": "run-complete", "status": "completed"},
            ],
            ("GET", "/api/v1/workspaces/ws-test/escalations"): [
                {"id": "esc-1", "status": "open"}
            ],
            ("GET", "/api/v1/workspaces/ws-test/inbox/summary"): {
                "unread_count": 2,
                "active_count": 3,
                "archived_count": 1,
            },
            ("GET", "/api/v1/workspaces/ws-test/participants"): [
                {"participant_id": "human:1", "display_name": "Hieu"}
            ],
            ("GET", "/api/v1/workspaces/ws-test/members"): {
                "items": [{"id": "agent-1", "name": "Wed", "kind": "agent"}],
                "total": 1,
                "page": 1,
                "page_size": 20,
            },
            ("GET", "/health"): {"status": "ok"},
        }
    )
    server = build_server(client)

    result = await server.call_tool("get_workspace_overview", {})

    payload = _tool_json(result)

    assert payload["workspace_id"] == "ws-test"
    assert [run["id"] for run in payload["active_runs"]] == ["run-active"]
    assert payload["open_escalations"][0]["id"] == "esc-1"
    assert payload["inbox_summary"]["unread_count"] == 2


@pytest.mark.asyncio
async def test_list_members_exposes_contribution_briefs_for_agent_routing_context():
    client = FakeAPIClient(
        {
            ("GET", "/api/v1/workspaces/ws-test/members"): {
                "items": [
                    {
                        "id": "member-1",
                        "name": "Support Lead",
                        "kind": "human",
                        "contribution_brief": "Customer support: bring customer pain into objectives.",
                        "availability_status": "busy",
                        "capacity_level": "limited",
                    }
                ],
                "total": 1,
                "page": 1,
                "page_size": 20,
            }
        }
    )
    server = build_server(client)

    result = await server.call_tool("list_members", {})

    payload = _tool_json(result)

    assert payload["items"][0]["contribution_brief"] == "Customer support: bring customer pain into objectives."
    assert payload["items"][0]["availability_status"] == "busy"
    assert payload["items"][0]["capacity_level"] == "limited"
    assert client.calls[-1] == {
        "method": "GET",
        "path": "/api/v1/workspaces/ws-test/members",
        "params": None,
        "json_body": None,
    }


@pytest.mark.asyncio
async def test_update_member_profile_reports_status_through_mcp():
    client = FakeAPIClient(
        {
            ("PATCH", "/api/v1/workspaces/ws-test/members/member-1"): {
                "id": "member-1",
                "name": "Support Agent",
                "kind": "agent",
                "availability_status": "busy",
                "capacity_level": "full",
                "status_note": "Processing customer escalations.",
                "current_commitments": [{"title": "Customer escalation review"}],
                "recent_work": [{"title": "Updated onboarding objective"}],
            }
        }
    )
    server = build_server(client)

    result = await server.call_tool(
        "update_member_profile",
        {
            "member_id": "member-1",
            "availability_status": "busy",
            "capacity_level": "full",
            "status_note": "Processing customer escalations.",
            "current_commitments": [{"title": "Customer escalation review"}],
            "recent_work": [{"title": "Updated onboarding objective"}],
        },
    )

    payload = _tool_json(result)

    assert payload["availability_status"] == "busy"
    assert client.calls[-1] == {
        "method": "PATCH",
        "path": "/api/v1/workspaces/ws-test/members/member-1",
        "params": None,
        "json_body": {
            "availability_status": "busy",
            "capacity_level": "full",
            "status_note": "Processing customer escalations.",
            "current_commitments": [{"title": "Customer escalation review"}],
            "recent_work": [{"title": "Updated onboarding objective"}],
        },
    }


@pytest.mark.asyncio
async def test_update_objective_uses_patch_route():
    client = FakeAPIClient(
        {
            ("PATCH", "/api/v1/workspaces/ws-test/objectives/obj-1"): {
                "id": "obj-1",
                "title": "Updated",
                "progress_percent": 55,
            }
        }
    )
    server = build_server(client)

    result = await server.call_tool(
        "update_objective",
        {
            "objective_ref": "obj-1",
            "updates": {"title": "Updated", "progress_percent": 55},
        },
    )

    payload = _tool_json(result)

    assert payload["title"] == "Updated"
    assert client.calls[-1] == {
        "method": "PATCH",
        "path": "/api/v1/workspaces/ws-test/objectives/obj-1",
        "params": None,
        "json_body": {"title": "Updated", "progress_percent": 55},
    }


@pytest.mark.asyncio
async def test_post_channel_message_routes_to_channel_messages():
    client = FakeAPIClient(
        {
            ("POST", "/api/v1/workspaces/ws-test/channels/general/messages"): {
                "id": "msg-1",
                "content": "Ship it",
            }
        }
    )
    server = build_server(client)

    result = await server.call_tool(
        "post_channel_message",
        {
            "channel_ref": "general",
            "content": "Ship it",
            "author_type": "human",
            "author_name": "Hieu",
        },
    )

    payload = _tool_json(result)

    assert payload["id"] == "msg-1"
    assert client.calls[-1]["path"] == "/api/v1/workspaces/ws-test/channels/general/messages"
    assert client.calls[-1]["json_body"]["content"] == "Ship it"
    assert client.calls[-1]["json_body"]["author_name"] == "Hieu"


@pytest.mark.asyncio
async def test_get_objective_chain_returns_root_to_current():
    client = FakeAPIClient(
        {
            ("GET", "/api/v1/workspaces/ws-test/objectives/current"): {
                "id": "current",
                "code": "S1.1.1",
                "title": "Current",
                "parent_objective_id": "parent",
            },
            ("GET", "/api/v1/workspaces/ws-test/objectives/parent"): {
                "id": "parent",
                "code": "S1.1",
                "title": "Parent",
                "parent_objective_id": "root",
            },
            ("GET", "/api/v1/workspaces/ws-test/objectives/root"): {
                "id": "root",
                "code": "S1",
                "title": "Root",
                "parent_objective_id": None,
            },
        }
    )
    server = build_server(client)

    result = await server.call_tool("get_objective_chain", {"objective_ref": "current"})

    payload = _tool_json_items(result)

    assert [item["id"] for item in payload] == ["root", "parent", "current"]
    assert [call["path"] for call in client.calls] == [
        "/api/v1/workspaces/ws-test/objectives/current",
        "/api/v1/workspaces/ws-test/objectives/parent",
        "/api/v1/workspaces/ws-test/objectives/root",
    ]


@pytest.mark.asyncio
async def test_get_current_member_returns_current_agent_participant_id(monkeypatch):
    monkeypatch.setattr(
        mcp_server,
        "get_access_token",
        lambda: type("Token", (), {"client_id": "user-agent"})(),
    )
    client = FakeAPIClient(
        {
            ("GET", "/api/v1/workspaces/ws-test/members"): {
                "items": [
                    {
                        "id": "agent-member",
                        "user_id": "user-agent",
                        "name": "Agent",
                        "kind": "agent",
                        "role": "operator",
                        "contribution_brief": "Landing page work.",
                    },
                    {
                        "id": "human-member",
                        "user_id": "user-human",
                        "name": "Human",
                        "kind": "human",
                    },
                ],
                "total": 2,
                "page": 1,
                "page_size": 100,
            }
        }
    )
    server = build_server(client)

    result = await server.call_tool("get_current_member", {})

    payload = _tool_json(result)

    assert payload["id"] == "agent-member"
    assert payload["participant_id"] == "agent:agent-member"
    assert payload["contribution_brief"] == "Landing page work."
    assert client.calls[-1] == {
        "method": "GET",
        "path": "/api/v1/workspaces/ws-test/members",
        "params": {"page_size": 100},
        "json_body": None,
    }


@pytest.mark.asyncio
async def test_list_channel_participants_routes_to_channel_participants():
    client = FakeAPIClient(
        {
            ("GET", "/api/v1/workspaces/ws-test/channels/general/participants"): [
                {
                    "channel_id": "general",
                    "participant_id": "agent:codex",
                    "display_name": "codex",
                    "mention_handle": "codex",
                    "kind": "agent",
                    "subscribed": True,
                }
            ]
        }
    )
    server = build_server(client)

    result = await server.call_tool("list_channel_participants", {"channel_ref": "general"})

    payload = _tool_json_items(result)

    assert payload[0]["participant_id"] == "agent:codex"
    assert client.calls[-1] == {
        "method": "GET",
        "path": "/api/v1/workspaces/ws-test/channels/general/participants",
        "params": None,
        "json_body": None,
    }

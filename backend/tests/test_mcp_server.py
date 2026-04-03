from __future__ import annotations

import json
from copy import deepcopy

import pytest

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

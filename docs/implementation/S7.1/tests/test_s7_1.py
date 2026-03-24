"""
S7.1 automated tests — Agent Registration.

Covers:
  - GET /workspaces/{id}/agents — empty list
  - POST /workspaces/{id}/agents — create Anthropic agent
  - POST /workspaces/{id}/agents — create OpenAI agent
  - api_key_hint is masked (last 4 chars only)
  - api_key is NOT returned in response
  - DELETE /workspaces/{id}/agents/{id} — soft delete (204)
  - Deleted agent does not appear in list
  - 404 on delete of non-existent agent
  - get_adapter with api_key passes key to ClaudeAdapter
  - get_adapter with api_key passes key to OpenAIAdapter
  - agent node makes DB lookup for registered_agent_id
"""
from __future__ import annotations

import pytest
import pytest_asyncio


# ── List agents ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_agents_empty(client, workspace):
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/agents")
    assert resp.status_code == 200
    assert resp.json() == []


# ── Create agents ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_anthropic_agent(client, workspace):
    payload = {
        "display_name": "Legal Claude",
        "provider": "anthropic",
        "agent_ref": "anthropic:claude-sonnet-4-6",
        "api_key": "sk-ant-api03-test-key-1234",
    }
    resp = await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["display_name"] == "Legal Claude"
    assert data["provider"] == "anthropic"
    assert data["agent_ref"] == "anthropic:claude-sonnet-4-6"


@pytest.mark.asyncio
async def test_create_openai_agent(client, workspace):
    payload = {
        "display_name": "Research GPT",
        "provider": "openai",
        "agent_ref": "openai:gpt-4o",
        "api_key": "sk-proj-testkey1234",
    }
    resp = await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["display_name"] == "Research GPT"
    assert data["provider"] == "openai"


# ── API key masking ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_api_key_hint_is_last_4_chars(client, workspace):
    payload = {
        "display_name": "Test Agent",
        "provider": "anthropic",
        "agent_ref": "anthropic:claude-haiku-4-5-20251001",
        "api_key": "sk-ant-very-secret-abcd",
    }
    resp = await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    # Only the last 4 chars are exposed
    assert data["api_key_hint"] == "abcd"
    # Full key must NOT appear anywhere in the response
    assert "sk-ant-very-secret-abcd" not in str(data)


@pytest.mark.asyncio
async def test_api_key_hint_none_when_no_key(client, workspace):
    payload = {
        "display_name": "OpenClaw Agent",
        "provider": "openclaw",
        "agent_ref": "openclaw:my-agent",
        # No api_key
    }
    resp = await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json=payload)
    assert resp.status_code == 201
    assert resp.json()["api_key_hint"] is None


# ── List after create ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_agents_returns_created(client, workspace):
    await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json={
        "display_name": "Alpha", "provider": "anthropic",
        "agent_ref": "anthropic:claude-sonnet-4-6", "api_key": "sk-1234",
    })
    await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json={
        "display_name": "Beta", "provider": "openai",
        "agent_ref": "openai:gpt-4o", "api_key": "sk-5678",
    })
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/agents")
    assert resp.status_code == 200
    names = [a["display_name"] for a in resp.json()]
    assert "Alpha" in names
    assert "Beta" in names


# ── Delete agent ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_agent(client, workspace):
    create = await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json={
        "display_name": "To Delete", "provider": "anthropic",
        "agent_ref": "anthropic:claude-sonnet-4-6", "api_key": "sk-del",
    })
    agent_id = create.json()["id"]

    resp = await client.delete(f"/api/v1/workspaces/{workspace.id}/agents/{agent_id}")
    assert resp.status_code == 204

    # Deleted agent should not appear in list
    list_resp = await client.get(f"/api/v1/workspaces/{workspace.id}/agents")
    ids = [a["id"] for a in list_resp.json()]
    assert agent_id not in ids


@pytest.mark.asyncio
async def test_delete_nonexistent_returns_404(client, workspace):
    import uuid
    resp = await client.delete(
        f"/api/v1/workspaces/{workspace.id}/agents/{uuid.uuid4()}"
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_wrong_workspace_returns_404(client, workspace, db):
    from knotwork.workspaces.models import Workspace
    other_ws = Workspace(name="Other", slug="other-s7-1")
    db.add(other_ws)
    await db.commit()
    await db.refresh(other_ws)

    create = await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json={
        "display_name": "Mine", "provider": "anthropic",
        "agent_ref": "anthropic:claude-sonnet-4-6", "api_key": "sk-mine",
    })
    agent_id = create.json()["id"]

    # Try to delete from a different workspace
    resp = await client.delete(f"/api/v1/workspaces/{other_ws.id}/agents/{agent_id}")
    assert resp.status_code == 404


# ── Adapter api_key pass-through ──────────────────────────────────────────────

@pytest.mark.xfail(reason="superseded by S8: direct LLM adapters replaced by openclaw plugin executor; get_adapter no longer returns ClaudeAdapter for anthropic refs")
def test_get_adapter_passes_api_key_to_claude():
    from knotwork.runtime.adapters import get_adapter
    from knotwork.runtime.adapters.claude import ClaudeAdapter
    adapter = get_adapter("anthropic:claude-sonnet-4-6", api_key="sk-custom")
    assert isinstance(adapter, ClaudeAdapter)
    assert adapter._api_key == "sk-custom"


@pytest.mark.xfail(reason="superseded by S8: direct LLM adapters replaced by openclaw plugin executor; get_adapter no longer returns OpenAIAdapter for openai refs")
def test_get_adapter_passes_api_key_to_openai():
    from knotwork.runtime.adapters import get_adapter
    from knotwork.runtime.adapters.openai_adapter import OpenAIAdapter
    adapter = get_adapter("openai:gpt-4o", api_key="sk-custom-openai")
    assert isinstance(adapter, OpenAIAdapter)
    assert adapter._api_key == "sk-custom-openai"


@pytest.mark.xfail(reason="superseded by S8: direct LLM adapters replaced by openclaw plugin executor; get_adapter no longer returns ClaudeAdapter for anthropic refs")
def test_get_adapter_no_key_defaults_to_none():
    from knotwork.runtime.adapters import get_adapter
    from knotwork.runtime.adapters.claude import ClaudeAdapter
    adapter = get_adapter("anthropic:claude-haiku-4-5-20251001")
    assert isinstance(adapter, ClaudeAdapter)
    assert adapter._api_key is None


# ── RegisteredAgent model ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_registered_agent_model_fields(db, workspace):
    from knotwork.registered_agents.models import RegisteredAgent
    ra = RegisteredAgent(
        workspace_id=workspace.id,
        display_name="My Agent",
        provider="anthropic",
        agent_ref="anthropic:claude-sonnet-4-6",
        api_key="sk-ant-secret-key",
    )
    db.add(ra)
    await db.commit()
    await db.refresh(ra)

    assert ra.display_name == "My Agent"
    assert ra.is_active is True
    assert ra.api_key == "sk-ant-secret-key"
    assert ra.created_at is not None


# ── Provider validation ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_invalid_provider_returns_422(client, workspace):
    resp = await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json={
        "display_name": "Bad", "provider": "invalid_provider",
        "agent_ref": "invalid:model",
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_and_patch_agent_profile(client, workspace):
    create = await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json={
        "display_name": "Profile Me",
        "provider": "openai",
        "agent_ref": "openai:gpt-4o",
        "api_key": "sk-test",
    })
    assert create.status_code == 201
    agent_id = create.json()["id"]

    get_resp = await client.get(f"/api/v1/workspaces/{workspace.id}/agents/{agent_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["display_name"] == "Profile Me"

    patch_resp = await client.patch(
        f"/api/v1/workspaces/{workspace.id}/agents/{agent_id}",
        json={"display_name": "Renamed Agent", "avatar_url": "https://example.com/a.png"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["display_name"] == "Renamed Agent"
    assert patch_resp.json()["avatar_url"] == "https://example.com/a.png"


@pytest.mark.asyncio
async def test_agent_history_lists_runs_and_workflows(client, workspace, db):
    from knotwork.graphs.models import Graph, GraphVersion
    from knotwork.runs.models import Run

    create = await client.post(f"/api/v1/workspaces/{workspace.id}/agents", json={
        "display_name": "History Agent",
        "provider": "openai",
        "agent_ref": "openai:gpt-4o",
        "api_key": "sk-hist",
    })
    agent_id = create.json()["id"]

    g = Graph(workspace_id=workspace.id, name="Workflow A")
    db.add(g)
    await db.flush()
    gv = GraphVersion(
        graph_id=g.id,
        definition={
            "nodes": [
                {"id": "start", "type": "start", "name": "Start", "config": {}},
                {
                    "id": "n1", "type": "agent", "name": "Node 1",
                    "agent_ref": "openai:gpt-4o", "registered_agent_id": agent_id, "config": {},
                },
                {"id": "end", "type": "end", "name": "End", "config": {}},
            ],
            "edges": [
                {"id": "e1", "source": "start", "target": "n1", "type": "direct"},
                {"id": "e2", "source": "n1", "target": "end", "type": "direct"},
            ],
        },
    )
    db.add(gv)
    await db.flush()
    run = Run(workspace_id=workspace.id, graph_id=g.id, graph_version_id=gv.id, status="completed", input={})
    db.add(run)
    await db.commit()

    hist = await client.get(f"/api/v1/workspaces/{workspace.id}/agents/{agent_id}/history")
    assert hist.status_code == 200
    payload = hist.json()
    assert len(payload) >= 1
    assert payload[0]["graph_name"] == "Workflow A"
    assert "Node 1" in payload[0]["involved_nodes"]


@pytest.mark.asyncio
async def test_graph_version_preserves_registered_agent_fields(client, workspace):
    """Saving graph versions must not drop registered-agent node fields."""
    create_resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/graphs",
        json={
            "name": "Agent persist test",
            "definition": {
                "nodes": [
                    {"id": "start", "type": "start", "name": "Start", "config": {}},
                    {
                        "id": "a1",
                        "type": "agent",
                        "name": "Agent 1",
                        "agent_ref": "openai:gpt-4o",
                        "trust_level": "supervised",
                        "registered_agent_id": "11111111-1111-1111-1111-111111111111",
                        "config": {},
                    },
                    {"id": "end", "type": "end", "name": "End", "config": {}},
                ],
                "edges": [
                    {"id": "e1", "source": "start", "target": "a1", "type": "direct"},
                    {"id": "e2", "source": "a1", "target": "end", "type": "direct"},
                ],
            },
        },
    )
    assert create_resp.status_code == 201
    graph = create_resp.json()
    node = next(n for n in graph["latest_version"]["definition"]["nodes"] if n["id"] == "a1")
    assert node["agent_ref"] == "openai:gpt-4o"
    assert node["trust_level"] == "supervised"
    assert node["registered_agent_id"] == "11111111-1111-1111-1111-111111111111"

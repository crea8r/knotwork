"""
S8 tests: Chat-First Agent Runtime.

Covers:
  - Session Execution Contract constants
  - KNOTWORK_TOOLS web_search addition
  - Skills/tool filtering (_is_hidden_skill_tool, _visible_tools)
  - Agent session naming (_agent_session_name)
  - Channel creation (run channel + agent_main channel)
  - Run chat messages API endpoint
  - Preflight writes to agent_main channel
"""
from __future__ import annotations

import pytest
from uuid import uuid4


# ── Session Execution Contract ─────────────────────────────────────────────────


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
def test_session_execution_contract_operations():
    """SESSION_EXECUTION_CONTRACT_OPERATIONS contains exactly the 3 canonical ops."""
    from knotwork.openclaw_integrations.service import SESSION_EXECUTION_CONTRACT_OPERATIONS

    assert set(SESSION_EXECUTION_CONTRACT_OPERATIONS) == {
        "create_session",
        "send_message",
        "sync_session",
    }


# ── Skills / tool filtering ────────────────────────────────────────────────────


def test_hidden_skill_tool_file():
    from knotwork.registered_agents.service import _is_hidden_skill_tool

    assert _is_hidden_skill_tool("file") is True


def test_hidden_skill_tool_shell():
    from knotwork.registered_agents.service import _is_hidden_skill_tool

    assert _is_hidden_skill_tool("shell") is True


def test_hidden_skill_tool_file_prefix():
    from knotwork.registered_agents.service import _is_hidden_skill_tool

    assert _is_hidden_skill_tool("file_read") is True


def test_hidden_skill_tool_shell_prefix():
    from knotwork.registered_agents.service import _is_hidden_skill_tool

    assert _is_hidden_skill_tool("shell_exec") is True


def test_hidden_skill_tool_other_allowed():
    from knotwork.registered_agents.service import _is_hidden_skill_tool

    assert _is_hidden_skill_tool("web_search") is False
    assert _is_hidden_skill_tool("write_worklog") is False


def test_visible_tools_filters_file_shell():
    from knotwork.registered_agents.service import _visible_tools

    tools = [
        {"name": "web_search", "description": "Search the web"},
        {"name": "file", "description": "File access"},
        {"name": "shell", "description": "Shell access"},
        {"name": "file_read", "description": "Read files"},
        {"name": "write_worklog", "description": "Worklog"},
    ]
    visible = _visible_tools(tools)
    visible_names = {t["name"] for t in visible}
    assert "file" not in visible_names
    assert "shell" not in visible_names
    assert "file_read" not in visible_names
    assert "web_search" in visible_names
    assert "write_worklog" in visible_names


# ── Agent session naming ───────────────────────────────────────────────────────


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
def test_agent_session_name_main():
    """agent_main channel uses mode='main'."""
    from knotwork.openclaw_integrations.service import _agent_session_name

    ws_id = uuid4()
    name = _agent_session_name("myagentkey", workspace_id=ws_id, mode="main")
    assert name == f"knotwork:myagentkey:{ws_id}:main"


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
def test_agent_session_name_run():
    """run channel uses mode='run' with a run_id."""
    from knotwork.openclaw_integrations.service import _agent_session_name

    ws_id = uuid4()
    run_id = uuid4()
    name = _agent_session_name(
        "myagentkey", workspace_id=ws_id, run_id=run_id, mode="run"
    )
    assert name == f"knotwork:myagentkey:{ws_id}:run:{run_id}"


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
def test_agent_session_name_handbook():
    """handbook channel uses mode='handbook'."""
    from knotwork.openclaw_integrations.service import _agent_session_name

    ws_id = uuid4()
    name = _agent_session_name("myagentkey", workspace_id=ws_id, mode="handbook")
    assert name == f"knotwork:myagentkey:{ws_id}:handbook"


# ── Channel creation ───────────────────────────────────────────────────────────


async def test_get_or_create_run_channel(db, workspace):
    """get_or_create_run_channel returns a channel with type='run'."""
    from knotwork.channels.service import get_or_create_run_channel

    run_id = uuid4()
    graph_id = uuid4()
    channel = await get_or_create_run_channel(
        db, workspace_id=workspace.id, run_id=run_id, graph_id=graph_id
    )
    assert channel.channel_type == "run"
    assert str(run_id) in channel.name


async def test_get_or_create_run_channel_idempotent(db, workspace):
    """Calling get_or_create_run_channel twice returns the same channel."""
    from knotwork.channels.service import get_or_create_run_channel

    run_id = uuid4()
    graph_id = uuid4()
    ch1 = await get_or_create_run_channel(
        db, workspace_id=workspace.id, run_id=run_id, graph_id=graph_id
    )
    ch2 = await get_or_create_run_channel(
        db, workspace_id=workspace.id, run_id=run_id, graph_id=graph_id
    )
    assert ch1.id == ch2.id


async def test_get_or_create_agent_main_channel(db, workspace, registered_agent):
    """get_or_create_agent_main_channel returns a channel with type='agent_main'."""
    from knotwork.channels.service import get_or_create_agent_main_channel

    channel = await get_or_create_agent_main_channel(
        db,
        workspace_id=workspace.id,
        agent_id=registered_agent.id,
        display_name=registered_agent.display_name,
    )
    assert channel.channel_type == "agent_main"


# ── Run chat messages API endpoint ────────────────────────────────────────────


async def test_run_chat_messages_endpoint_unknown_run(client, workspace):
    """GET /runs/{id}/chat-messages returns 404 for unknown run."""
    run_id = uuid4()
    resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/runs/{run_id}/chat-messages"
    )
    assert resp.status_code == 404


async def test_run_chat_messages_endpoint_with_messages(client, db, workspace):
    """GET /runs/{id}/chat-messages returns persisted chat messages in order."""
    from knotwork.channels.service import get_or_create_run_channel, create_message
    from knotwork.channels.schemas import ChannelMessageCreate
    from knotwork.graphs.models import Graph, GraphVersion
    from knotwork.runs.models import Run

    # create graph + run
    g = Graph(workspace_id=workspace.id, name="Chat Test Graph")
    db.add(g)
    await db.flush()
    v = GraphVersion(
        graph_id=g.id,
        definition={"nodes": [], "edges": [], "entry_point": None},
    )
    db.add(v)
    await db.flush()
    run = Run(
        workspace_id=workspace.id,
        graph_id=g.id,
        graph_version_id=v.id,
        status="completed",
        input={},
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    channel = await get_or_create_run_channel(
        db, workspace_id=workspace.id, run_id=run.id, graph_id=g.id
    )
    await create_message(
        db,
        workspace_id=workspace.id,
        channel_id=channel.id,
        data=ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            content="Node started.",
            run_id=run.id,
            metadata={"kind": "agent_progress"},
        ),
    )
    await create_message(
        db,
        workspace_id=workspace.id,
        channel_id=channel.id,
        data=ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            content="Node finished.",
            run_id=run.id,
            metadata={"kind": "node_output"},
        ),
    )

    resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/runs/{run.id}/chat-messages"
    )
    assert resp.status_code == 200
    msgs = resp.json()
    assert len(msgs) == 2
    assert msgs[0]["content"] == "Node started."
    assert msgs[1]["content"] == "Node finished."


# ── Preflight writes to agent_main ────────────────────────────────────────────


async def _seed_capability_snapshot(db, workspace, agent):
    """Create a minimal AgentCapabilitySnapshot so run_preflight can proceed."""
    from knotwork.registered_agents.models import AgentCapabilitySnapshot

    snap = AgentCapabilitySnapshot(
        workspace_id=workspace.id,
        agent_id=agent.id,
        hash="test-hash-001",
        source="refresh",
        tools_json=[
            {"name": "web_search", "description": "Search"},
            {"name": "file", "description": "File access"},
            {"name": "shell", "description": "Shell access"},
            {"name": "write_worklog", "description": "Log"},
        ],
        constraints_json={},
        policy_notes_json=[],
        raw_contract_json={},
    )
    db.add(snap)
    await db.commit()
    return snap


@pytest.mark.xfail(reason="superseded: preflight no longer sends LLM prompts to the main chat channel (removed in S8.2)")
async def test_preflight_via_api_writes_agent_main_channel(
    client, db, workspace, registered_agent
):
    """POST /agents/{id}/preflight-runs writes a prompt to the agent_main channel."""
    from knotwork.channels.models import ChannelMessage
    from sqlalchemy import select

    await _seed_capability_snapshot(db, workspace, registered_agent)

    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/agents/{registered_agent.id}/preflight-runs",
        json={"suite": "default", "include_optional": False},
    )
    assert resp.status_code in (200, 201)

    msgs = (
        await db.execute(
            select(ChannelMessage).where(
                ChannelMessage.workspace_id == workspace.id,
            )
        )
    ).scalars().all()
    prompt_msgs = [
        m for m in msgs if (m.metadata_ or {}).get("kind") == "preflight_prompt"
    ]
    assert len(prompt_msgs) >= 1


@pytest.mark.xfail(reason="superseded: preflight prompt removed in S8.2 — capability check is now contract-only, no LLM message")
async def test_preflight_prompt_excludes_hidden_skills(
    client, db, workspace, registered_agent
):
    """The preflight prompt instructs the agent to exclude file and shell skills."""
    from knotwork.channels.models import ChannelMessage
    from sqlalchemy import select

    await _seed_capability_snapshot(db, workspace, registered_agent)

    await client.post(
        f"/api/v1/workspaces/{workspace.id}/agents/{registered_agent.id}/preflight-runs",
        json={"suite": "default", "include_optional": False},
    )

    msgs = (
        await db.execute(
            select(ChannelMessage).where(
                ChannelMessage.workspace_id == workspace.id,
            )
        )
    ).scalars().all()
    prompt_msgs = [
        m for m in msgs if (m.metadata_ or {}).get("kind") == "preflight_prompt"
    ]
    assert prompt_msgs, "No preflight_prompt message found"
    # The prompt itself must mention excluding file and shell
    prompt_text = prompt_msgs[0].content.lower()
    assert "file" in prompt_text or "shell" in prompt_text

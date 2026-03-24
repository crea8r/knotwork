"""
S7 automated tests — Agent Architecture Pivot.

Covers:
  - Adapter registry (get_adapter)
  - HumanAdapter event stream
  - KNOTWORK_TOOLS structure
  - compile_graph with 'agent' node type
  - Handbook proposal CRUD endpoints
  - Builtin endpoints removed (404)
"""
from __future__ import annotations

import pytest
import pytest_asyncio


# ── Adapter registry ──────────────────────────────────────────────────────────

def test_get_adapter_human():
    from knotwork.runtime.adapters import get_adapter
    from knotwork.runtime.adapters.human import HumanAdapter
    adapter = get_adapter("human")
    assert isinstance(adapter, HumanAdapter)


@pytest.mark.xfail(reason="superseded by S8: direct LLM adapters replaced by openclaw plugin executor; get_adapter no longer returns ClaudeAdapter for anthropic refs")
def test_get_adapter_anthropic():
    from knotwork.runtime.adapters import get_adapter
    from knotwork.runtime.adapters.claude import ClaudeAdapter
    adapter = get_adapter("anthropic:claude-sonnet-4-6")
    assert isinstance(adapter, ClaudeAdapter)


@pytest.mark.xfail(reason="superseded by S8: direct LLM adapters replaced by openclaw plugin executor; get_adapter no longer returns OpenAIAdapter for openai refs")
def test_get_adapter_openai():
    from knotwork.runtime.adapters import get_adapter
    from knotwork.runtime.adapters.openai_adapter import OpenAIAdapter
    adapter = get_adapter("openai:gpt-4o")
    assert isinstance(adapter, OpenAIAdapter)


def test_get_adapter_unknown():
    from knotwork.runtime.adapters import get_adapter
    with pytest.raises(ValueError, match="Unknown agent_ref"):
        get_adapter("unknown:model")


# ── HumanAdapter ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_human_adapter_yields_escalation():
    from knotwork.runtime.adapters.human import HumanAdapter

    adapter = HumanAdapter()
    node_def = {"id": "review", "config": {"question": "Please review this output."}}
    events = []
    async for event in adapter.run_node(node_def, {}, object(), "fake-token"):
        events.append(event)

    assert len(events) == 1
    assert events[0].type == "escalation"
    assert "question" in events[0].payload
    assert events[0].payload["question"] == "Please review this output."


@pytest.mark.asyncio
async def test_human_adapter_default_question():
    from knotwork.runtime.adapters.human import HumanAdapter

    adapter = HumanAdapter()
    events = []
    async for event in adapter.run_node({"id": "x", "config": {}}, {}, object(), ""):
        events.append(event)

    assert events[0].type == "escalation"
    assert events[0].payload["question"] == "Awaiting human review."


# ── KNOTWORK_TOOLS ────────────────────────────────────────────────────────────

def test_knotwork_tools_count():
    from knotwork.runtime.adapters.tools import KNOTWORK_TOOLS
    assert len(KNOTWORK_TOOLS) == 4


def test_knotwork_tools_names():
    from knotwork.runtime.adapters.tools import KNOTWORK_TOOLS
    names = {t["name"] for t in KNOTWORK_TOOLS}
    assert names == {"write_worklog", "propose_handbook_update", "escalate", "complete_node"}


def test_knotwork_tools_have_input_schema():
    from knotwork.runtime.adapters.tools import KNOTWORK_TOOLS
    for tool in KNOTWORK_TOOLS:
        assert "input_schema" in tool, f"Tool {tool['name']} missing input_schema"
        assert "properties" in tool["input_schema"]


# ── NodeEvent ─────────────────────────────────────────────────────────────────

def test_node_event_defaults():
    from knotwork.runtime.adapters.base import NodeEvent
    ev = NodeEvent(type="started")
    assert ev.type == "started"
    assert ev.payload == {}


def test_node_event_payload():
    from knotwork.runtime.adapters.base import NodeEvent
    ev = NodeEvent(type="completed", payload={"output": "done", "next_branch": None})
    assert ev.payload["output"] == "done"


# ── compile_graph with agent node ────────────────────────────────────────────

def test_compile_graph_agent_node():
    """compile_graph should accept a graph with 'agent' type nodes."""
    from knotwork.runtime.engine import compile_graph

    definition = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start", "config": {}},
            {
                "id": "analyse",
                "type": "agent",
                "name": "Analyse",
                "agent_ref": "human",
                "trust_level": "supervised",
                "config": {},
            },
            {"id": "end", "type": "end", "name": "End", "config": {}},
        ],
        "edges": [
            {"id": "e0", "source": "start", "target": "analyse", "type": "direct"},
            {"id": "e1", "source": "analyse", "target": "end", "type": "direct"},
        ],
    }
    graph = compile_graph(definition)
    assert graph is not None


def test_compile_graph_tool_executor_raises():
    """tool_executor type should raise RuntimeError — it's been removed."""
    from knotwork.runtime.engine import compile_graph

    definition = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start", "config": {}},
            {"id": "run_tool", "type": "tool_executor", "name": "Run Tool", "config": {}},
            {"id": "end", "type": "end", "name": "End", "config": {}},
        ],
        "edges": [
            {"id": "e0", "source": "start", "target": "run_tool", "type": "direct"},
            {"id": "e1", "source": "run_tool", "target": "end", "type": "direct"},
        ],
    }
    with pytest.raises(RuntimeError, match="tool_executor"):
        compile_graph(definition)


# ── Proposal CRUD ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_proposals_empty(client, workspace):
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/handbook/proposals")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_proposals_with_status_filter(client, workspace, db):
    """Insert a pending proposal, filter by status."""
    from knotwork.runs.models import Run, RunHandbookProposal
    from knotwork.graphs.models import Graph, GraphVersion

    g = Graph(workspace_id=workspace.id, name="g")
    db.add(g)
    await db.flush()
    gv = GraphVersion(graph_id=g.id, definition={"nodes": [], "edges": []})
    db.add(gv)
    await db.flush()

    run = Run(
        workspace_id=workspace.id,
        graph_id=g.id,
        graph_version_id=gv.id,
        status="completed",
        input={},
    )
    db.add(run)
    await db.flush()

    proposal = RunHandbookProposal(
        run_id=run.id,
        node_id="analyse",
        agent_ref="anthropic:claude-sonnet-4-6",
        path="procedures/test.md",
        proposed_content="# Updated content",
        reason="Improve clarity",
        status="pending",
    )
    db.add(proposal)
    await db.commit()

    # All proposals
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/handbook/proposals")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # Filter pending
    resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/handbook/proposals",
        params={"status": "pending"},
    )
    assert resp.status_code == 200
    assert resp.json()[0]["status"] == "pending"

    # Filter approved — should be empty
    resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/handbook/proposals",
        params={"status": "approved"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_reject_proposal(client, workspace, db):
    from knotwork.runs.models import Run, RunHandbookProposal
    from knotwork.graphs.models import Graph, GraphVersion

    g = Graph(workspace_id=workspace.id, name="g2")
    db.add(g)
    await db.flush()
    gv = GraphVersion(graph_id=g.id, definition={"nodes": [], "edges": []})
    db.add(gv)
    await db.flush()

    run = Run(workspace_id=workspace.id, graph_id=g.id, graph_version_id=gv.id, status="completed", input={})
    db.add(run)
    await db.flush()

    proposal = RunHandbookProposal(
        run_id=run.id,
        node_id="x",
        agent_ref="human",
        path="test/file.md",
        proposed_content="new content",
        reason="because",
        status="pending",
    )
    db.add(proposal)
    await db.commit()

    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/handbook/proposals/{proposal.id}/reject"
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"


@pytest.mark.asyncio
async def test_reject_already_rejected_returns_409(client, workspace, db):
    from knotwork.runs.models import Run, RunHandbookProposal
    from knotwork.graphs.models import Graph, GraphVersion

    g = Graph(workspace_id=workspace.id, name="g3")
    db.add(g)
    await db.flush()
    gv = GraphVersion(graph_id=g.id, definition={"nodes": [], "edges": []})
    db.add(gv)
    await db.flush()

    run = Run(workspace_id=workspace.id, graph_id=g.id, graph_version_id=gv.id, status="completed", input={})
    db.add(run)
    await db.flush()

    proposal = RunHandbookProposal(
        run_id=run.id,
        node_id="x",
        agent_ref="human",
        path="test/file2.md",
        proposed_content="content",
        reason="r",
        status="rejected",
    )
    db.add(proposal)
    await db.commit()

    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/handbook/proposals/{proposal.id}/reject"
    )
    assert resp.status_code == 409


# ── Builtins removed ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_builtins_endpoint_removed(client, workspace):
    resp = await client.get(f"/api/v1/workspaces/{workspace.id}/builtins")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_test_builtin_endpoint_removed(client, workspace):
    resp = await client.post(f"/api/v1/workspaces/{workspace.id}/builtins/calc/test", json={})
    assert resp.status_code == 404

from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import libs.database
from modules.workflows.backend.runs.models import Run, RunNodeState
from modules.workflows.backend.runtime.nodes.agent import make_agent_node


class DummyInterrupt(Exception):
    pass


@pytest.mark.asyncio
async def test_participant_node_resume_does_not_create_duplicate_request(
    db: AsyncSession,
    engine,
    graph,
    workspace,
    monkeypatch,
):
    run = Run(
        workspace_id=workspace.id,
        graph_id=graph.id,
        graph_version_id=None,
        input={"business": "Elite Fitness"},
        context_files=[],
        trigger="manual",
        status="running",
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    escalation_id = uuid4()
    created_messages: list[dict] = []
    created_escalations: list[UUID] = []
    interrupt_calls = 0

    async def fake_resolve_participant_ids(_db, _workspace_id, participant_ids):
        return list(participant_ids)

    async def fake_load_knowledge_tree(*args, **kwargs):
        return SimpleNamespace(fragments=[], missing_links=[], version_snapshot={})

    async def fake_create_participant_escalation(**kwargs):
        created_escalations.append(escalation_id)
        return escalation_id

    async def fake_get_or_create_run_channel(*args, **kwargs):
        return SimpleNamespace(id=uuid4())

    async def fake_create_message(_db, workspace_id, channel_id, data):
        created_messages.append({
            "workspace_id": str(workspace_id),
            "channel_id": str(channel_id),
            "node_id": data.node_id,
            "content": data.content,
            "metadata": data.metadata,
        })
        return SimpleNamespace(id=uuid4())

    async def fake_publish_event(*args, **kwargs):
        return None

    def fake_interrupt(payload):
        nonlocal interrupt_calls
        interrupt_calls += 1
        if interrupt_calls == 1:
            raise DummyInterrupt(payload)
        return {
            "resolution": "accept_output",
            "answers": ["Done"],
            "actor_participant_id": "human:operator",
        }

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(libs.database, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr("libs.participants.resolve_participant_ids", fake_resolve_participant_ids)
    monkeypatch.setattr("modules.workflows.backend.runtime.knowledge_loader.load_knowledge_tree", fake_load_knowledge_tree)
    monkeypatch.setattr("modules.workflows.backend.runtime.nodes.agent._create_participant_escalation", fake_create_participant_escalation)
    monkeypatch.setattr("core.api.facades.channels.get_or_create_run_channel", fake_get_or_create_run_channel)
    monkeypatch.setattr("core.api.facades.channels.create_message", fake_create_message)
    monkeypatch.setattr("modules.workflows.backend.runtime.events.publish_event", fake_publish_event)
    monkeypatch.setattr("langgraph.types.interrupt", fake_interrupt)

    node = make_agent_node(
        {
            "id": "work",
            "type": "agent",
            "name": "Work",
            "agent_ref": "openclaw",
            "operator_id": "human:operator",
            "supervisor_id": "human:supervisor",
            "config": {"question": "Do the work"},
        },
        [],
    )
    state = {
        "run_id": run.id,
        "workspace_id": str(workspace.id),
        "graph_id": str(graph.id),
        "input": {"business": "Elite Fitness"},
        "current_output": None,
        "node_visit_counts": {},
        "messages": [],
    }

    with pytest.raises(DummyInterrupt):
        await node(state)

    assert len(created_escalations) == 1
    assert len(created_messages) == 1

    result = await node(state)

    assert len(created_escalations) == 1
    assert len(created_messages) == 1
    assert result["current_output"] == "Done"

    node_states = (await db.execute(select(RunNodeState).where(RunNodeState.run_id == run.id))).scalars().all()
    assert len(node_states) == 1
    assert node_states[0].status == "completed"
    assert node_states[0].input.get("active_escalation_id") is None

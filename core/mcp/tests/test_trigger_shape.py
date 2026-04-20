from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.mcp.contracts.work_packet_builder import render_trigger
from core.mcp.contracts.work_packet_context import (
    LoadedWorkPacketContext,
    _primary_asset,
    normalize_trigger,
    trigger_message_id,
    trigger_run_id,
)


def test_normalize_trigger_moves_flat_fields_into_detail() -> None:
    trigger = normalize_trigger(
        {
            "type": "task_assigned",
            "channel_id": "channel-1",
            "run_id": "run-1",
            "message_id": "msg-1",
            "title": "Task assigned",
            "subtitle": "Review this",
        }
    )

    assert trigger == {
        "type": "task_assigned",
        "channel_id": "channel-1",
        "title": "Task assigned",
        "subtitle": "Review this",
        "detail": {
            "message_id": "msg-1",
            "run_id": "run-1",
            "task": {
                "run_id": "run-1",
            },
        },
    }
    assert trigger_message_id(trigger) == "msg-1"
    assert trigger_run_id(trigger) == "run-1"


def test_render_trigger_includes_type_specific_task_details() -> None:
    trigger = normalize_trigger(
        {
            "type": "task_assigned",
            "channel_id": "channel-1",
            "run_id": "run-1",
            "message_id": "msg-1",
            "title": "Task assigned",
            "subtitle": "Review this",
        }
    )
    trigger_message = SimpleNamespace(
        id="msg-1",
        metadata_={
            "kind": "request",
            "request": {
                "type": "agent_question",
                "status": "open",
                "questions": ["What should happen next?"],
                "assigned_to": ["agent:operator"],
                "response_schema": {"kind": "decision"},
                "escalation_id": "esc-1",
            },
        },
    )
    context = LoadedWorkPacketContext(
        workspace=SimpleNamespace(id="workspace-1", name="Workspace"),
        current_user=SimpleNamespace(name="Agent"),
        member=SimpleNamespace(id="member-1", role="agent", kind="agent", contribution_brief=None, availability_status="available", capacity_level="open"),
        task_id="task-1",
        trigger=trigger,
        session_name=None,
        legacy_user_prompt=None,
        self_participant_id="agent:operator",
        channel=SimpleNamespace(id="channel-1", objective_id=None, graph_id=None),
        channel_messages=[],
        participants=[],
        assets=[],
        trigger_message=trigger_message,
        run=SimpleNamespace(id="run-1"),
        escalation=None,
        graph=None,
        root_draft=None,
        objective_chain=[],
        primary_asset=None,
    )

    rendered = render_trigger(context)

    assert rendered == {
        "type": "task_assigned",
        "channel_id": "channel-1",
        "title": "Task assigned",
        "subtitle": "Review this",
        "detail": {
            "message_id": "msg-1",
            "run_id": "run-1",
            "task": {
                "message_id": "msg-1",
                "run_id": "run-1",
                "escalation_id": "esc-1",
                "type": "agent_question",
                "status": "open",
                "questions": ["What should happen next?"],
                "assigned_to": ["agent:operator"],
                "response_schema": {"kind": "decision"},
            },
        },
    }


def test_primary_asset_selection_uses_helper_without_shadowing() -> None:
    trigger = normalize_trigger(
        {
            "type": "knowledge_change",
            "channel_id": "channel-1",
            "proposal_id": "proposal-1",
            "asset_type": "workflow",
            "asset_id": "asset-2",
            "title": "Knowledge changed",
        }
    )

    asset = _primary_asset(
        [
            {"asset_type": "workflow", "asset_id": "asset-1", "asset_path": "one.md"},
            {"asset_type": "workflow", "asset_id": "asset-2", "asset_path": "two.md"},
        ],
        trigger,
    )

    assert asset == {"asset_type": "workflow", "asset_id": "asset-2", "asset_path": "two.md"}

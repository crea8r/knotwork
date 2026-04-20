from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.mcp.contracts.schemas import MCPActionResult
from core.mcp.contracts.workflow_sessions import ComposedWorkflowMCPContractProvider
import core.mcp.contracts.workflow_sessions as workflow_sessions


@pytest.mark.asyncio
async def test_run_resolution_actions_load_channel_context_for_workflow_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = ComposedWorkflowMCPContractProvider()
    loaded_context = object()
    observed: dict[str, object] = {}

    async def fake_load_channel_context(db, *, workspace_id, source_channel_id, trigger_message_id):
        observed["workspace_id"] = workspace_id
        observed["source_channel_id"] = source_channel_id
        observed["trigger_message_id"] = trigger_message_id
        return loaded_context

    async def fake_execute_workflow_action(
        db,
        *,
        workspace_id,
        current_user,
        member,
        action_id,
        action_name,
        target,
        payload,
        loaded_channel_context,
        fallback_run_id,
        fallback_trigger_message_id,
    ):
        observed["action_name"] = action_name
        observed["loaded_channel_context"] = loaded_channel_context
        observed["fallback_run_id"] = fallback_run_id
        observed["fallback_trigger_message_id"] = fallback_trigger_message_id
        return MCPActionResult(action_id=action_id, status="applied")

    monkeypatch.setattr(workflow_sessions, "load_channel_context", fake_load_channel_context)
    monkeypatch.setattr(workflow_sessions, "execute_workflow_action", fake_execute_workflow_action)

    workspace_id = uuid4()
    result = await provider.execute(
        db=SimpleNamespace(),
        workspace_id=workspace_id,
        current_user=SimpleNamespace(),
        member=SimpleNamespace(),
        contract_id="channel.request.response",
        action_id="action-1",
        action_name="run.resolve_request",
        target={"request_message_id": "message-1"},
        payload={"resolution": "accept_output"},
        fallback_run_id="run-1",
        fallback_source_channel_id="channel-1",
        fallback_trigger_message_id="message-1",
    )

    assert result.status == "applied"
    assert observed == {
        "workspace_id": workspace_id,
        "source_channel_id": "channel-1",
        "trigger_message_id": "message-1",
        "action_name": "run.resolve_request",
        "loaded_channel_context": loaded_context,
        "fallback_run_id": "run-1",
        "fallback_trigger_message_id": "message-1",
    }

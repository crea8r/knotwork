from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

from core.mcp.contracts.schemas import MCPContractManifest


def _load_run_contracts_module():
    path = Path(__file__).resolve().parents[1] / "backend" / "mcp_contracts" / "run_contracts.py"
    spec = importlib.util.spec_from_file_location("test_run_contracts_module", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_run_request_contract_uses_explicit_workflow_resolution_action() -> None:
    run_contracts = _load_run_contracts_module()
    specs = run_contracts.build_run_session_specs()
    request_contract = specs["channel.request.response"]

    assert "run.resolve_request" in request_contract.allowed_actions
    assert "run.escalate_to_supervisor" in request_contract.allowed_actions
    assert any("run.resolve_request" in instruction for instruction in request_contract.instructions)
    assert any("run.escalate_to_supervisor" in instruction for instruction in request_contract.instructions)
    assert any("accept_output" in instruction for instruction in request_contract.instructions)
    assert request_contract.examples[0].action == {
        "action": "context.get_request_context",
        "target": {},
        "payload": {},
    }
    assert request_contract.examples[1].action == {
        "action": "run.resolve_request",
        "target": {"request_message_id": "message-id"},
        "payload": {
            "resolution": "accept_output",
            "answers": [
                "Elite Fitness Đà Nẵng is located at Vĩnh Trung Plaza B, 255–257 Hùng Vương, Thanh Khê, Đà Nẵng. Sources: official site, Foody, GlobalGymBunny.",
            ],
        },
    }


def test_request_context_is_preloaded_for_request_sessions() -> None:
    run_contracts = _load_run_contracts_module()
    action = run_contracts.build_request_context_action()
    assert action.visibility == "initial"


def test_stale_task_assigned_request_noops_instead_of_followup() -> None:
    run_contracts = _load_run_contracts_module()
    manifests = {
        "telemetry.observe": MCPContractManifest(
            id="telemetry.observe",
            title="Telemetry Observe",
            owning_module="workflows",
            session_types=["telemetry.observe"],
            instructions=["This interaction is telemetry only."],
            allowed_actions=["context.get_trigger_message", "context.get_run_summary", "control.noop", "control.fail"],
            context_sections=[],
            actions=[],
        ),
        "channel.request.response": MCPContractManifest(
            id="channel.request.response",
            title="Channel Request Response",
            owning_module="workflows",
            session_types=["channel.request.operator"],
            instructions=[],
            allowed_actions=[],
            context_sections=[],
            actions=[],
        ),
        "workflow.escalation.review": MCPContractManifest(
            id="workflow.escalation.review",
            title="Workflow Escalation Review",
            owning_module="workflows",
            session_types=["workflow.escalation.review"],
            instructions=[],
            allowed_actions=[],
            context_sections=[],
            actions=[],
        ),
        "workflow.run.followup": MCPContractManifest(
            id="workflow.run.followup",
            title="Workflow Run Follow-up",
            owning_module="workflows",
            session_types=["workflow.run.followup"],
            instructions=[],
            allowed_actions=[],
            context_sections=[],
            actions=[],
        ),
    }
    contract = run_contracts.resolve_run_session_contract(
        {
            "trigger_type": "task_assigned",
            "channel_type": "run",
            "request": {"status": "superseded"},
            "run_present": True,
            "escalation_present": False,
            "is_telemetry_trigger": False,
        },
        manifests=manifests,
    )

    assert contract is not None
    assert contract.session_type == "telemetry.observe"
    assert contract.immediate_instruction == "This assigned request is no longer active. Do not reply."
    assert contract.preferred_actions == ["control.noop"]

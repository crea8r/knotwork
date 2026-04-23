from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.mcp.contracts.registry import (
    get_mcp_contract,
    register_mcp_contract_provider,
    reset_mcp_contract_registry,
    resolve_mcp_contract,
    resolve_mcp_contract_for_work_packet,
)
from core.mcp.contracts.schemas import MCPContract, MCPContractManifest
from core.mcp.contracts.work_packet_context import LoadedWorkPacketContext


class _DummyProvider:
    id = "dummy.provider"

    def __init__(self) -> None:
        self.manifest = MCPContractManifest(
            id="dummy.contract",
            title="Dummy Contract",
            owning_module="communication",
            session_types=["dummy.session"],
            allowed_actions=["control.noop"],
            context_sections=[],
            instructions=["Stay scoped."],
            actions=[],
        )

    def manifests(self) -> list[MCPContractManifest]:
        return [self.manifest]

    def resolve(self, context: dict) -> MCPContract | None:
        if context.get("trigger_type") != "dummy":
            return None
        return MCPContract(
            session_type="dummy.session",
            mode_instructions=list(self.manifest.instructions),
            preferred_actions=list(self.manifest.allowed_actions),
            contract=self.manifest,
        )

    def resolve_loaded_context(self, loaded_context: LoadedWorkPacketContext) -> MCPContract | None:
        if loaded_context.trigger.get("type") != "dummy":
            return None
        return MCPContract(
            session_type="dummy.session",
            mode_instructions=list(self.manifest.instructions),
            preferred_actions=list(self.manifest.allowed_actions),
            contract=self.manifest,
        )


def test_resolved_contract_uses_registered_manifest_checksum() -> None:
    reset_mcp_contract_registry()
    provider = _DummyProvider()
    register_mcp_contract_provider(provider)

    resolved = resolve_mcp_contract({"trigger_type": "dummy"})
    registered = get_mcp_contract("dummy.contract")

    assert registered.checksum
    assert resolved.contract.id == registered.id
    assert resolved.contract.checksum == registered.checksum


def test_resolved_work_packet_contract_uses_registered_manifest_checksum() -> None:
    reset_mcp_contract_registry()
    provider = _DummyProvider()
    register_mcp_contract_provider(provider)

    context = LoadedWorkPacketContext(
        workspace=SimpleNamespace(id="workspace-1", name="Workspace"),
        current_user=SimpleNamespace(name="Agent"),
        member=SimpleNamespace(
            id="member-1",
            role="agent",
            kind="agent",
            contribution_brief=None,
            availability_status="available",
            capacity_level="open",
        ),
        task_id="task-1",
        trigger={"type": "dummy"},
        session_name=None,
        legacy_user_prompt=None,
        self_participant_id="agent:member-1",
        channel=None,
        channel_messages=[],
        participants=[],
        assets=[],
        trigger_message=None,
        run=None,
        escalation=None,
        graph=None,
        root_draft=None,
        objective_chain=[],
        primary_asset=None,
    )

    resolved = resolve_mcp_contract_for_work_packet(context)
    registered = get_mcp_contract("dummy.contract")

    assert registered.checksum
    assert resolved.contract.contract.id == registered.id
    assert resolved.contract.contract.checksum == registered.checksum

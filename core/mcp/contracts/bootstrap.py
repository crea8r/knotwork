from __future__ import annotations

from modules.assets.backend.mcp_contract_provider import AssetsMCPContractProvider
from modules.communication.backend.mcp_contract_provider import CommunicationMCPContractProvider

from .registry import register_mcp_contract_provider, reset_mcp_contract_registry
from .snapshots import persist_mcp_contract_snapshot
from .workflow_sessions import ComposedWorkflowMCPContractProvider


def bootstrap_mcp_contracts(*, distribution_code: str) -> dict[str, str]:
    reset_mcp_contract_registry()
    register_mcp_contract_provider(ComposedWorkflowMCPContractProvider())
    register_mcp_contract_provider(AssetsMCPContractProvider())
    register_mcp_contract_provider(CommunicationMCPContractProvider())
    return persist_mcp_contract_snapshot(distribution_code=distribution_code)

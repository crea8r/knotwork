from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from libs.auth.backend.deps import get_workspace_member

from .registry import get_mcp_contract, list_mcp_contracts
from .schemas import MCPContractManifest

router = APIRouter(prefix="/workspaces", tags=["mcp-contracts"])


@router.get("/{workspace_id}/mcp/contracts", response_model=list[MCPContractManifest])
async def list_mcp_contracts_route(
    workspace_id: UUID,
    _member = Depends(get_workspace_member),
):
    return list_mcp_contracts()


@router.get("/{workspace_id}/mcp/contracts/{contract_id}", response_model=MCPContractManifest)
async def get_mcp_contract_route(
    workspace_id: UUID,
    contract_id: str,
    _member = Depends(get_workspace_member),
):
    try:
        return get_mcp_contract(contract_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

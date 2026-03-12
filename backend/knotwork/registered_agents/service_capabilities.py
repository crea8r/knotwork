"""Capability snapshot CRUD, refresh, and compatibility checks."""
from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.registered_agents.models import AgentCapabilitySnapshot
from knotwork.registered_agents.schemas import (
    CapabilityContractOut,
    CapabilityRefreshOut,
    CapabilityRefreshRequest,
    CapabilitySnapshotOut,
    CompatibilityCheckOut,
    CompatibilityCheckRequest,
    CompatibilityWarning,
)
from knotwork.registered_agents.service_contract import (
    _build_default_contract,
    _build_openclaw_contract,
    _capability_out,
)
from knotwork.registered_agents.service_utils import _get_agent_row, _hash_contract, _now


async def get_latest_capability(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID
) -> CapabilityContractOut:
    _ = await _get_agent_row(db, workspace_id, agent_id)
    res = await db.execute(
        select(AgentCapabilitySnapshot)
        .where(AgentCapabilitySnapshot.agent_id == agent_id)
        .order_by(AgentCapabilitySnapshot.created_at.desc())
        .limit(1)
    )
    row = res.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="No capability snapshot found")
    return _capability_out(row)


async def list_capabilities(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, limit: int = 20
) -> list[CapabilitySnapshotOut]:
    _ = await _get_agent_row(db, workspace_id, agent_id)
    res = await db.execute(
        select(AgentCapabilitySnapshot)
        .where(AgentCapabilitySnapshot.agent_id == agent_id)
        .order_by(AgentCapabilitySnapshot.created_at.desc())
        .limit(min(max(limit, 1), 100))
    )
    out: list[CapabilitySnapshotOut] = []
    for row in res.scalars():
        item = _capability_out(row)
        out.append(
            CapabilitySnapshotOut(
                id=row.id,
                agent_id=item.agent_id,
                version=item.version,
                hash=item.hash,
                refreshed_at=item.refreshed_at,
                tools=item.tools,
                constraints=item.constraints,
                policy_notes=item.policy_notes,
                raw=item.raw,
                changed_from_previous=row.changed_from_previous,
                source=row.source,
            )
        )
    return out


async def refresh_capabilities(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, data: CapabilityRefreshRequest
) -> CapabilityRefreshOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)

    if ra.provider == "openclaw":
        contract = await _build_openclaw_contract(db, workspace_id, ra)
    else:
        contract = _build_default_contract(ra)
    contract_hash = _hash_contract(contract)

    prev = await db.execute(
        select(AgentCapabilitySnapshot)
        .where(AgentCapabilitySnapshot.agent_id == ra.id)
        .order_by(AgentCapabilitySnapshot.created_at.desc())
        .limit(1)
    )
    prev_row = prev.scalar_one_or_none()
    changed = prev_row is None or prev_row.hash != contract_hash

    if data.save_snapshot:
        snapshot = AgentCapabilitySnapshot(
            id=uuid4(),
            workspace_id=workspace_id,
            agent_id=ra.id,
            version=contract.get("version"),
            hash=contract_hash,
            source="refresh",
            tools_json=contract.get("tools", []),
            constraints_json=contract.get("constraints", {}),
            policy_notes_json=contract.get("policy_notes", []),
            raw_contract_json=contract.get("raw", {}),
            changed_from_previous=changed,
            created_at=_now(),
        )
        db.add(snapshot)

    ra.capability_version = contract.get("version")
    ra.capability_hash = contract_hash
    ra.capability_refreshed_at = _now()
    ra.capability_freshness = "fresh"
    if changed and ra.preflight_status in ("pass", "warning"):
        ra.preflight_status = "never_run"
    ra.updated_at = _now()
    await db.commit()

    latest = await get_latest_capability(db, workspace_id, agent_id)
    return CapabilityRefreshOut(changed=changed, capability=latest)


async def compatibility_check(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, data: CompatibilityCheckRequest
) -> CompatibilityCheckOut:
    warnings: list[CompatibilityWarning] = []
    missing: list[str] = []

    contract = await get_latest_capability(db, workspace_id, agent_id)
    tool_names = {t.name for t in contract.tools}
    req = data.requirements or {}

    for tool in (req.get("required_tools") or []):
        if tool not in tool_names:
            missing.append(f"tools.{tool}")
            warnings.append(CompatibilityWarning(
                code="MISSING_TOOL",
                message=f"Tool {tool} not present in capability contract",
            ))

    if req.get("needs_web_search") and "web_search" not in tool_names:
        if "tools.web_search" not in missing:
            missing.append("tools.web_search")
        warnings.append(CompatibilityWarning(
            code="MISSING_WEB_SEARCH",
            message="This step requires web_search but the agent does not expose it.",
        ))

    max_expected = req.get("max_expected_runtime_seconds")
    if isinstance(max_expected, (int, float)):
        max_runtime = (contract.constraints or {}).get("max_runtime_seconds")
        if isinstance(max_runtime, (int, float)) and max_expected > max_runtime:
            warnings.append(CompatibilityWarning(
                code="RUNTIME_LIMIT",
                message=f"Expected runtime ({int(max_expected)}s) exceeds agent limit ({int(max_runtime)}s).",
            ))

    return CompatibilityCheckOut(
        compatible=len(missing) == 0,
        warnings=warnings,
        missing_capabilities=missing,
    )

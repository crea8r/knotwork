"""Capability contract builders for registered agents."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.openclaw_integrations.models import OpenClawRemoteAgent
from knotwork.registered_agents.models import RegisteredAgent
from knotwork.registered_agents.schemas import CapabilityContractOut, CapabilityTool
from knotwork.registered_agents.models import AgentCapabilitySnapshot
from knotwork.registered_agents.service_utils import _normalize_tool, _visible_tools


def _build_default_contract(ra: RegisteredAgent) -> dict:
    """Deterministic capability contract per provider (used when no synced data exists)."""
    if ra.provider == "openclaw":
        tools = []
        constraints = {
            "network": "plugin_managed",
            "file_system": "none",
            "max_tool_calls": 20,
            "max_runtime_seconds": 240,
        }
        notes = ["No synced OpenClaw capability found yet. Run plugin sync, then refresh capability."]
    else:
        tools = [
            {"name": "write_worklog", "description": "Write run worklog.",
             "input_schema": {"type": "object"}, "risk_class": "low"},
            {"name": "propose_handbook_update", "description": "Propose handbook update.",
             "input_schema": {"type": "object"}, "risk_class": "medium"},
            {"name": "escalate", "description": "Escalate to human.",
             "input_schema": {"type": "object"}, "risk_class": "low"},
            {"name": "complete_node", "description": "Complete current node.",
             "input_schema": {"type": "object"}, "risk_class": "low"},
        ]
        constraints = {
            "network": "provider_managed",
            "search_providers": [],
            "file_system": "none",
            "max_tool_calls": 20,
            "max_runtime_seconds": 240,
        }
        notes = ["Provider-managed tool availability is transitional and may be opaque."]

    return {
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "tools": tools,
        "constraints": constraints,
        "policy_notes": notes,
        "raw": {
            "provider": ra.provider,
            "agent_ref": ra.agent_ref,
            "endpoint": ra.endpoint,
        },
    }


async def _build_openclaw_contract(
    db: AsyncSession, workspace_id: UUID, ra: RegisteredAgent
) -> dict:
    """Build capability contract from synced OpenClaw remote agent data."""
    if not ra.openclaw_integration_id or not ra.openclaw_remote_agent_id:
        return _build_default_contract(ra)

    row_res = await db.execute(
        select(OpenClawRemoteAgent).where(
            and_(
                OpenClawRemoteAgent.workspace_id == workspace_id,
                OpenClawRemoteAgent.integration_id == ra.openclaw_integration_id,
                OpenClawRemoteAgent.remote_agent_id == ra.openclaw_remote_agent_id,
            )
        )
    )
    remote = row_res.scalar_one_or_none()
    if remote is None:
        return _build_default_contract(ra)

    raw_tools = remote.tools_json or []
    tools = _visible_tools([_normalize_tool(t) for t in raw_tools if isinstance(t, dict)])
    notes = [
        f"Synced from OpenClaw agent '{remote.display_name}' ({remote.slug}).",
        f"Last synced at {remote.last_synced_at.isoformat()}",
    ]
    return {
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "tools": tools,
        "constraints": remote.constraints_json or {},
        "policy_notes": notes,
        "raw": {
            "provider": ra.provider,
            "agent_ref": ra.agent_ref,
            "endpoint": ra.endpoint,
            "openclaw_integration_id": str(ra.openclaw_integration_id),
            "openclaw_remote_agent_id": ra.openclaw_remote_agent_id,
            "remote_agent_slug": remote.slug,
            "remote_agent_display_name": remote.display_name,
            "last_synced_at": remote.last_synced_at.isoformat(),
        },
    }


def _capability_out(snapshot: AgentCapabilitySnapshot) -> CapabilityContractOut:
    return CapabilityContractOut(
        agent_id=snapshot.agent_id,
        version=snapshot.version,
        hash=snapshot.hash,
        refreshed_at=snapshot.created_at,
        tools=[CapabilityTool(**t) for t in (snapshot.tools_json or [])],
        constraints=snapshot.constraints_json or {},
        policy_notes=snapshot.policy_notes_json or [],
        raw=snapshot.raw_contract_json or {},
    )

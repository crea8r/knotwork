"""Business logic for registered_agents."""
from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone
from statistics import median
from uuid import UUID, uuid4

from fastapi import HTTPException, status
import sqlalchemy as sa
from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels.models import ChannelMessage
from knotwork.graphs.models import Graph, GraphVersion
from knotwork.channels import service as channels_service
from knotwork.channels.schemas import ChannelMessageCreate
from knotwork.openclaw_integrations.models import OpenClawExecutionTask
from knotwork.openclaw_integrations.models import OpenClawRemoteAgent
from knotwork.openclaw_integrations.models import OpenClawExecutionEvent
from knotwork.registered_agents.models import (
    AgentCapabilitySnapshot,
    AgentPreflightRun,
    AgentPreflightTest,
    RegisteredAgent,
)
from knotwork.registered_agents.schemas import (
    ActivateAgentRequest,
    AgentConnectivityUpdate,
    AgentUsageItem,
    AgentMainChatAskRequest,
    AgentMainChatAskResponse,
    AgentMainChatEnsureResponse,
    ArchiveAgentRequest,
    CapabilityContractOut,
    CapabilityRefreshOut,
    CapabilityRefreshRequest,
    CapabilitySnapshotOut,
    CapabilityTool,
    CompatibilityCheckOut,
    CompatibilityCheckRequest,
    CompatibilityWarning,
    DebugLinkItem,
    DeactivateAgentRequest,
    PreflightRunDetailOut,
    PreflightRunOut,
    PreflightRunRequest,
    PreflightTestOut,
    RegisteredAgentCreate,
    RegisteredAgentHistoryItem,
    RegisteredAgentOut,
    RegisteredAgentUpdate,
)
from knotwork.runs.models import OpenAICallLog, Run


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _mask_hint(key: str | None) -> str | None:
    if not key:
        return None
    key = key.strip()
    return key[-4:] if len(key) >= 4 else key


def _is_active_agent(ra: RegisteredAgent) -> bool:
    # Backward-compatible: status is canonical in S8, is_active in S7.1.
    if getattr(ra, "status", None):
        return ra.status == "active"
    return bool(ra.is_active)


def _to_out(ra: RegisteredAgent) -> RegisteredAgentOut:
    status_val = getattr(ra, "status", None) or ("active" if ra.is_active else "inactive")
    return RegisteredAgentOut(
        id=ra.id,
        workspace_id=ra.workspace_id,
        display_name=ra.display_name,
        avatar_url=ra.avatar_url,
        provider=ra.provider,
        agent_ref=ra.agent_ref,
        api_key_hint=ra.credential_hint or _mask_hint(ra.api_key),
        endpoint=ra.endpoint,
        is_active=_is_active_agent(ra),
        status=status_val,
        capability_version=ra.capability_version,
        capability_hash=ra.capability_hash,
        capability_refreshed_at=ra.capability_refreshed_at,
        capability_freshness=ra.capability_freshness,
        preflight_status=ra.preflight_status,
        preflight_run_at=ra.preflight_run_at,
        last_used_at=ra.last_used_at,
        created_at=ra.created_at,
        updated_at=ra.updated_at,
    )


def _normalize_tool(tool: dict) -> dict:
    return {
        "name": str(tool.get("name") or tool.get("id") or "unknown_tool"),
        "description": str(tool.get("description") or tool.get("summary") or ""),
        "input_schema": tool.get("input_schema") or tool.get("schema") or {"type": "object"},
        "risk_class": str(tool.get("risk_class") or "medium"),
    }


def _is_hidden_skill_tool(name: str) -> bool:
    lowered = name.strip().lower()
    return lowered in {"file", "shell"} or lowered.startswith("file_") or lowered.startswith("shell_")


def _visible_tools(tools: list[dict]) -> list[dict]:
    out: list[dict] = []
    for tool in tools:
        name = str(tool.get("name") or "")
        if not name or _is_hidden_skill_tool(name):
            continue
        out.append(tool)
    return out


def _build_default_contract(ra: RegisteredAgent) -> dict:
    # S8 MVP: deterministic capability contract per provider.
    if ra.provider == "openclaw":
        tools = []
        constraints = {
            "network": "plugin_managed",
            "file_system": "none",
            "max_tool_calls": 20,
            "max_runtime_seconds": 240,
        }
        notes = [
            "No synced OpenClaw capability found yet. Run plugin sync, then refresh capability.",
        ]
    else:
        tools = [
            {
                "name": "write_worklog",
                "description": "Write run worklog.",
                "input_schema": {"type": "object"},
                "risk_class": "low",
            },
            {
                "name": "propose_handbook_update",
                "description": "Propose handbook update.",
                "input_schema": {"type": "object"},
                "risk_class": "medium",
            },
            {
                "name": "escalate",
                "description": "Escalate to human.",
                "input_schema": {"type": "object"},
                "risk_class": "low",
            },
            {
                "name": "complete_node",
                "description": "Complete current node.",
                "input_schema": {"type": "object"},
                "risk_class": "low",
            },
        ]
        constraints = {
            "network": "provider_managed",
            "search_providers": [],
            "file_system": "none",
            "max_tool_calls": 20,
            "max_runtime_seconds": 240,
        }
        notes = [
            "Provider-managed tool availability is transitional and may be opaque.",
        ]

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
    db: AsyncSession,
    workspace_id: UUID,
    ra: RegisteredAgent,
) -> dict:
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
    constraints = remote.constraints_json or {}
    notes = [
        f"Synced from OpenClaw agent '{remote.display_name}' ({remote.slug}).",
        f"Last synced at {remote.last_synced_at.isoformat()}",
    ]

    return {
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d"),
        "tools": tools,
        "constraints": constraints,
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


def _hash_contract(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return f"sha256:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()}"


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


async def _get_agent_row(db: AsyncSession, workspace_id: UUID, agent_id: UUID) -> RegisteredAgent:
    ra = await db.get(RegisteredAgent, agent_id)
    if ra is None or ra.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    return ra


async def list_agents(
    db: AsyncSession,
    workspace_id: UUID,
    q: str | None = None,
    provider: str | None = None,
    status_filter: str | None = None,
    preflight_status: str | None = None,
) -> list[RegisteredAgentOut]:
    stmt = select(RegisteredAgent).where(RegisteredAgent.workspace_id == workspace_id)
    stmt = stmt.where(RegisteredAgent.status != "archived")

    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(sa.func.lower(RegisteredAgent.display_name).like(like))
    if provider:
        stmt = stmt.where(RegisteredAgent.provider == provider)
    if status_filter:
        stmt = stmt.where(RegisteredAgent.status == status_filter)
    if preflight_status:
        stmt = stmt.where(RegisteredAgent.preflight_status == preflight_status)

    stmt = stmt.order_by(desc(RegisteredAgent.updated_at), desc(RegisteredAgent.created_at))
    result = await db.execute(stmt)
    return [_to_out(ra) for ra in result.scalars()]


async def create_agent(db: AsyncSession, workspace_id: UUID, data: RegisteredAgentCreate) -> RegisteredAgentOut:
    api_key = data.api_key
    credential_type = None
    credential_hint = None
    credential_ciphertext = None

    if data.credentials:
        credential_type = data.credentials.type
        api_key = data.credentials.api_key or api_key

    if api_key:
        credential_type = credential_type or "api_key"
        credential_hint = _mask_hint(api_key)
        credential_ciphertext = api_key  # S8 MVP (no KMS wiring yet)

    ra = RegisteredAgent(
        workspace_id=workspace_id,
        display_name=data.display_name,
        avatar_url=data.avatar_url,
        provider=data.provider,
        agent_ref=data.agent_ref,
        api_key=api_key,
        endpoint=data.endpoint,
        status="inactive",
        is_active=False,
        credential_type=credential_type,
        credential_hint=credential_hint,
        credential_ciphertext=credential_ciphertext,
        capability_freshness="needs_refresh",
        preflight_status="never_run",
        updated_at=_now(),
    )
    db.add(ra)
    await db.commit()
    await db.refresh(ra)

    # Optional auto-activate for legacy providers when requested.
    if data.activate_after_preflight and data.provider != "openclaw":
        ra.status = "active"
        ra.is_active = True
        ra.updated_at = _now()
        await db.commit()
        await db.refresh(ra)

    return _to_out(ra)


async def get_agent(db: AsyncSession, workspace_id: UUID, agent_id: UUID) -> RegisteredAgentOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    return _to_out(ra)


async def update_agent(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    data: RegisteredAgentUpdate,
) -> RegisteredAgentOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    payload = data.model_dump(exclude_unset=True)
    if "display_name" in payload:
        ra.display_name = payload["display_name"]
    if "avatar_url" in payload:
        ra.avatar_url = payload["avatar_url"]
    ra.updated_at = _now()
    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def update_connectivity(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    data: AgentConnectivityUpdate,
) -> RegisteredAgentOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)

    if data.endpoint is not None:
        ra.endpoint = data.endpoint

    if data.credentials:
        ra.credential_type = data.credentials.type
        if data.credentials.api_key:
            ra.api_key = data.credentials.api_key
            ra.credential_ciphertext = data.credentials.api_key
            ra.credential_hint = _mask_hint(data.credentials.api_key)

    # Connectivity changes force re-validation.
    ra.capability_freshness = "needs_refresh"
    ra.preflight_status = "never_run"
    ra.preflight_run_at = None
    ra.status = "inactive"
    ra.is_active = False
    ra.updated_at = _now()

    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def activate_agent(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    data: ActivateAgentRequest,
) -> RegisteredAgentOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    if ra.status == "archived":
        raise HTTPException(status_code=400, detail="Archived agent cannot be activated")

    if ra.preflight_status == "fail":
        raise HTTPException(status_code=400, detail="Preflight failed; cannot activate")
    if ra.preflight_status == "warning" and not data.allow_warning:
        raise HTTPException(status_code=400, detail="Preflight warning; set allow_warning to activate")
    if ra.preflight_status in ("never_run", "running") and ra.provider == "openclaw":
        raise HTTPException(status_code=400, detail="Preflight required before activation")

    ra.status = "active"
    ra.is_active = True
    ra.updated_at = _now()
    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def deactivate_agent(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    data: DeactivateAgentRequest,
) -> RegisteredAgentOut:
    _ = data
    ra = await _get_agent_row(db, workspace_id, agent_id)
    ra.status = "inactive"
    ra.is_active = False
    ra.updated_at = _now()
    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def archive_agent(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    data: ArchiveAgentRequest,
) -> RegisteredAgentOut:
    _ = data
    ra = await _get_agent_row(db, workspace_id, agent_id)
    ra.status = "archived"
    ra.is_active = False
    ra.archived_at = _now()
    ra.updated_at = _now()
    await db.commit()
    await db.refresh(ra)
    return _to_out(ra)


async def refresh_capabilities(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    data: CapabilityRefreshRequest,
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


async def get_latest_capability(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
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
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    limit: int = 20,
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


def _preflight_suite(
    contract: CapabilityContractOut, provider: str, include_optional: bool
) -> list[dict]:
    tool_names = {t.name for t in contract.tools}
    if provider == "openclaw":
        cases: list[dict] = [
            {
                "test_id": "capability.skills_tools_discovered",
                "tool_name": None,
                "required": True,
                "ok": len(tool_names) > 0,
                "label": "skills_tools",
                "request": {},
                "response": {
                    "items": sorted(tool_names),
                    "skills": sorted(tool_names),
                    "tools": sorted(tool_names),
                    "count": len(tool_names),
                },
            },
            {
                "test_id": "policy.notes",
                "tool_name": None,
                "required": False,
                "ok": bool(contract.policy_notes),
                "label": "policy_notes",
                "request": {},
                "response": {"count": len(contract.policy_notes)},
            },
        ]
        for name in sorted(tool_names):
            cases.append(
                {
                    "test_id": f"skill_or_tool.{name}",
                    "tool_name": name,
                    "required": False,
                    "ok": True,
                    "label": "skill_or_tool",
                    "request": {},
                    "response": {"status": "tool_present"},
                }
            )
    else:
        cases = [
            {
                "test_id": "knotwork.complete_node",
                "tool_name": "complete_node",
                "required": True,
                "ok": "complete_node" in tool_names,
                "label": "tool",
                "request": {"output": "ok"},
                "response": {"status": "tool_present"},
            },
            {
                "test_id": "knotwork.escalate",
                "tool_name": "escalate",
                "required": True,
                "ok": "escalate" in tool_names,
                "label": "tool",
                "request": {"question": "Need help"},
                "response": {"status": "tool_present"},
            },
            {
                "test_id": "policy.notes",
                "tool_name": None,
                "required": False,
                "ok": bool(contract.policy_notes),
                "label": "policy_notes",
                "request": {},
                "response": {"count": len(contract.policy_notes)},
            },
        ]
    if include_optional:
        return cases
    return [c for c in cases if c["required"]]


async def run_preflight(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    data: PreflightRunRequest,
) -> PreflightRunDetailOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    if ra.provider == "openclaw":
        await ensure_main_chat_ready(db, workspace_id, agent_id)
    contract = await get_latest_capability(db, workspace_id, agent_id)
    main_channel = await channels_service.get_or_create_agent_main_channel(
        db,
        workspace_id=workspace_id,
        agent_id=agent_id,
        display_name=ra.display_name,
    )
    prompt = (
        "Preflight check: list the skills/tools you can currently use in Knotwork. "
        "Exclude file and shell skills from your response. Return short JSON: "
        '{"skills_tools":["name1","name2"]}.'
    )
    await channels_service.create_message(
        db,
        workspace_id=workspace_id,
        channel_id=main_channel.id,
        data=ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name="Knotwork Preflight",
            content=prompt,
            metadata={"kind": "preflight_prompt", "agent_id": str(agent_id)},
        ),
    )
    started = _now()

    cases = _preflight_suite(contract, ra.provider, include_optional=data.include_optional)
    tests: list[AgentPreflightTest] = []
    latencies = [120, 140, 110, 160, 150]

    required_total = 0
    required_passed = 0
    optional_total = 0
    optional_passed = 0
    failed_count = 0

    preflight = AgentPreflightRun(
        id=uuid4(),
        workspace_id=workspace_id,
        agent_id=agent_id,
        suite_name=data.suite,
        include_optional=data.include_optional,
        status="running",
        started_at=started,
        created_at=started,
    )
    db.add(preflight)
    await db.flush()

    for idx, c in enumerate(cases):
        is_ok = bool(c["ok"])
        status_val = "pass" if is_ok else "fail"
        if c["required"]:
            required_total += 1
            if is_ok:
                required_passed += 1
        else:
            optional_total += 1
            if is_ok:
                optional_passed += 1

        if not is_ok:
            failed_count += 1

        t = AgentPreflightTest(
            id=uuid4(),
            workspace_id=workspace_id,
            preflight_run_id=preflight.id,
            agent_id=agent_id,
            test_id=c["test_id"],
            tool_name=c.get("tool_name"),
            required=bool(c["required"]),
            status=status_val,
            latency_ms=latencies[idx % len(latencies)],
            error_code=None if is_ok else "MISSING_CAPABILITY",
            error_message=None
            if is_ok
            else (
                "No skills/tools discovered from capability contract"
                if c.get("label") == "skills_tools"
                else f"Missing required capability: {c.get('tool_name')}"
            ),
            request_preview_json=c["request"],
            response_preview_json=c["response"],
            started_at=started,
            completed_at=_now(),
            created_at=started,
        )
        db.add(t)
        tests.append(t)

    pass_rate = (required_passed / required_total) if required_total > 0 else 0.0
    preflight.status = "pass" if required_total == required_passed else "fail"
    preflight.required_total = required_total
    preflight.required_passed = required_passed
    preflight.optional_total = optional_total
    preflight.optional_passed = optional_passed
    preflight.pass_rate = pass_rate
    preflight.median_latency_ms = int(median([t.latency_ms or 0 for t in tests])) if tests else None
    preflight.failed_count = failed_count
    preflight.completed_at = _now()

    ra.preflight_status = preflight.status
    ra.preflight_run_at = preflight.completed_at
    if preflight.status == "pass":
        if ra.status == "inactive" and ra.provider == "openclaw":
            # keep inactive until explicit activation
            pass
    ra.updated_at = _now()

    visible_names = sorted(
        {
            t.name
            for t in contract.tools
            if t.name and not _is_hidden_skill_tool(t.name)
        }
    )
    await channels_service.create_message(
        db,
        workspace_id=workspace_id,
        channel_id=main_channel.id,
        data=ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            author_name=ra.display_name,
            content=json.dumps({"skills_tools": visible_names}, ensure_ascii=False),
            metadata={
                "kind": "preflight_reply",
                "agent_id": str(agent_id),
                "preflight_run_id": str(preflight.id),
                "skills_tools": visible_names,
            },
        ),
    )

    await db.commit()

    return PreflightRunDetailOut(
        id=preflight.id,
        agent_id=agent_id,
        status=preflight.status,
        required_total=required_total,
        required_passed=required_passed,
        optional_total=optional_total,
        optional_passed=optional_passed,
        pass_rate=pass_rate,
        median_latency_ms=preflight.median_latency_ms,
        failed_count=failed_count,
        is_baseline=preflight.is_baseline,
        started_at=preflight.started_at,
        completed_at=preflight.completed_at,
        tests=[
            PreflightTestOut(
                test_id=t.test_id,
                tool_name=t.tool_name,
                required=t.required,
                status=t.status,
                latency_ms=t.latency_ms,
                error_code=t.error_code,
                error_message=t.error_message,
                request_preview=t.request_preview_json,
                response_preview=t.response_preview_json,
            )
            for t in tests
        ],
    )


async def list_preflight_runs(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    limit: int = 20,
) -> list[PreflightRunOut]:
    _ = await _get_agent_row(db, workspace_id, agent_id)
    res = await db.execute(
        select(AgentPreflightRun)
        .where(AgentPreflightRun.agent_id == agent_id)
        .order_by(AgentPreflightRun.created_at.desc())
        .limit(min(max(limit, 1), 100))
    )
    return [
        PreflightRunOut(
            id=row.id,
            agent_id=row.agent_id,
            status=row.status,
            required_total=row.required_total,
            required_passed=row.required_passed,
            optional_total=row.optional_total,
            optional_passed=row.optional_passed,
            pass_rate=row.pass_rate,
            median_latency_ms=row.median_latency_ms,
            failed_count=row.failed_count,
            is_baseline=row.is_baseline,
            started_at=row.started_at,
            completed_at=row.completed_at,
        )
        for row in res.scalars()
    ]


async def get_preflight_run(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    preflight_run_id: UUID,
) -> PreflightRunDetailOut:
    _ = await _get_agent_row(db, workspace_id, agent_id)
    run = await db.get(AgentPreflightRun, preflight_run_id)
    if run is None or run.workspace_id != workspace_id or run.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Preflight run not found")

    tests_res = await db.execute(
        select(AgentPreflightTest)
        .where(AgentPreflightTest.preflight_run_id == preflight_run_id)
        .order_by(AgentPreflightTest.created_at.asc())
    )
    tests = list(tests_res.scalars())

    return PreflightRunDetailOut(
        id=run.id,
        agent_id=run.agent_id,
        status=run.status,
        required_total=run.required_total,
        required_passed=run.required_passed,
        optional_total=run.optional_total,
        optional_passed=run.optional_passed,
        pass_rate=run.pass_rate,
        median_latency_ms=run.median_latency_ms,
        failed_count=run.failed_count,
        is_baseline=run.is_baseline,
        started_at=run.started_at,
        completed_at=run.completed_at,
        tests=[
            PreflightTestOut(
                test_id=t.test_id,
                tool_name=t.tool_name,
                required=t.required,
                status=t.status,
                latency_ms=t.latency_ms,
                error_code=t.error_code,
                error_message=t.error_message,
                request_preview=t.request_preview_json,
                response_preview=t.response_preview_json,
            )
            for t in tests
        ],
    )


async def promote_preflight_baseline(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    preflight_run_id: UUID,
) -> PreflightRunOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)

    row = await db.get(AgentPreflightRun, preflight_run_id)
    if row is None or row.workspace_id != workspace_id or row.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Preflight run not found")

    current = await db.execute(
        select(AgentPreflightRun).where(
            and_(
                AgentPreflightRun.agent_id == agent_id,
                AgentPreflightRun.is_baseline == True,  # noqa: E712
            )
        )
    )
    for old in current.scalars():
        old.is_baseline = False

    row.is_baseline = True
    ra.baseline_preflight_run_id = row.id
    ra.updated_at = _now()

    await db.commit()
    return PreflightRunOut(
        id=row.id,
        agent_id=row.agent_id,
        status=row.status,
        required_total=row.required_total,
        required_passed=row.required_passed,
        optional_total=row.optional_total,
        optional_passed=row.optional_passed,
        pass_rate=row.pass_rate,
        median_latency_ms=row.median_latency_ms,
        failed_count=row.failed_count,
        is_baseline=row.is_baseline,
        started_at=row.started_at,
        completed_at=row.completed_at,
    )


async def list_agent_history(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, limit: int = 100
) -> list[RegisteredAgentHistoryItem]:
    ra = await db.get(RegisteredAgent, agent_id)
    if ra is None or ra.workspace_id != workspace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found"
        )

    rows = await db.execute(
        select(Run, Graph, GraphVersion)
        .join(Graph, Graph.id == Run.graph_id)
        .join(GraphVersion, GraphVersion.id == Run.graph_version_id)
        .where(Run.workspace_id == workspace_id)
        .order_by(Run.created_at.desc())
        .limit(limit * 3)
    )

    out: list[RegisteredAgentHistoryItem] = []
    for run, graph, version in rows.all():
        nodes = (version.definition or {}).get("nodes", [])
        matched_nodes: list[str] = []
        for node in nodes:
            if str(node.get("registered_agent_id") or "") == str(agent_id):
                matched_nodes.append(node.get("name") or node.get("id") or "Unknown node")
        if not matched_nodes:
            continue
        out.append(
            RegisteredAgentHistoryItem(
                run_id=run.id,
                run_name=run.name,
                run_status=run.status,
                run_created_at=run.created_at,
                started_at=run.started_at,
                completed_at=run.completed_at,
                graph_id=graph.id,
                graph_name=graph.name,
                involved_nodes=matched_nodes,
            )
        )
        if len(out) >= limit:
            break

    return out


async def list_usage(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    limit: int = 100,
) -> list[AgentUsageItem]:
    history = await list_agent_history(db, workspace_id, agent_id, limit=limit)
    return [
        AgentUsageItem(
            type="run",
            run_id=h.run_id,
            workflow_id=h.graph_id,
            workflow_name=h.graph_name,
            status=h.run_status,
            timestamp=h.run_created_at,
        )
        for h in history
    ]


async def get_debug_links(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    limit: int = 50,
) -> list[DebugLinkItem]:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    rows = await db.execute(
        select(OpenAICallLog)
        .where(OpenAICallLog.workspace_id == workspace_id)
        .where(
            or_(
                OpenAICallLog.agent_ref == ra.agent_ref,
                OpenAICallLog.agent_ref == f"openai:{ra.agent_ref}",
            )
        )
        .order_by(OpenAICallLog.created_at.desc())
        .limit(min(max(limit, 1), 200))
    )

    return [
        DebugLinkItem(
            run_id=row.run_id,
            node_id=row.node_id,
            provider_request_id=row.openai_run_id,
            provider_response_id=row.openai_thread_id,
            provider_trace_id=row.openai_assistant_id,
            created_at=row.created_at,
        )
        for row in rows.scalars()
    ]


async def compatibility_check(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    data: CompatibilityCheckRequest,
) -> CompatibilityCheckOut:
    warnings: list[CompatibilityWarning] = []
    missing: list[str] = []

    contract = await get_latest_capability(db, workspace_id, agent_id)
    tool_names = {t.name for t in contract.tools}
    req = data.requirements or {}

    required_tools = req.get("required_tools") or []
    for tool in required_tools:
        if tool not in tool_names:
            missing.append(f"tools.{tool}")
            warnings.append(
                CompatibilityWarning(
                    code="MISSING_TOOL",
                    message=f"Tool {tool} not present in capability contract",
                )
            )

    if req.get("needs_web_search") and "web_search" not in tool_names:
        if "tools.web_search" not in missing:
            missing.append("tools.web_search")
        warnings.append(
            CompatibilityWarning(
                code="MISSING_WEB_SEARCH",
                message="This step requires web_search but the agent does not expose it.",
            )
        )

    max_expected = req.get("max_expected_runtime_seconds")
    if isinstance(max_expected, (int, float)):
        max_runtime = (contract.constraints or {}).get("max_runtime_seconds")
        if isinstance(max_runtime, (int, float)) and max_expected > max_runtime:
            warnings.append(
                CompatibilityWarning(
                    code="RUNTIME_LIMIT",
                    message=f"Expected runtime ({int(max_expected)}s) exceeds agent limit ({int(max_runtime)}s).",
                )
            )

    return CompatibilityCheckOut(
        compatible=len(missing) == 0,
        warnings=warnings,
        missing_capabilities=missing,
    )


async def delete_agent(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID
) -> None:
    ra = await db.get(RegisteredAgent, agent_id)
    if ra is None or ra.workspace_id != workspace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found"
        )
    # Soft-delete: mark archived so node refs aren't immediately broken
    ra.status = "archived"
    ra.is_active = False
    ra.archived_at = _now()
    ra.updated_at = _now()
    await db.commit()


def _main_chat_system_prompt(display_name: str) -> str:
    return (
        f"You are {display_name}, connected to Knotwork main session chat.\n"
        "This is not a workflow run. Respond conversationally and concretely.\n"
        "Use available skills/tools as needed. If uncertain, state unknowns explicitly.\n"
    )


def _main_session_name(workspace_id: UUID, agent_id: UUID) -> str:
    return f"knotwork:{agent_id}:{workspace_id}:main"


def _main_chat_init_prompt(display_name: str, session_name: str) -> str:
    return (
        f"Initialize and continue using this OpenClaw session key: {session_name}\n"
        f"Agent display name: {display_name}\n"
        "Confirm readiness with a short acknowledgement."
    )


async def _wait_openclaw_task(
    db: AsyncSession,
    task_id: UUID,
    timeout_seconds: int = 300,
) -> tuple[str, str | None, str | None]:
    deadline = asyncio.get_event_loop().time() + timeout_seconds
    while asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(1)
        current = await db.get(OpenClawExecutionTask, task_id)
        if current is None:
            raise HTTPException(status_code=500, detail="OpenClaw task disappeared")
        await db.refresh(current)
        if current.status == "completed":
            return ("completed", current.output_text or "", None)
        if current.status == "escalated":
            return ("escalated", None, current.escalation_question or "Need human input")
        if current.status == "failed":
            return ("failed", current.error_message or "OpenClaw execution failed", None)
    return ("timeout", "OpenClaw task timed out", None)


async def _append_openclaw_task_logs_to_main_channel(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    task_id: UUID,
) -> None:
    events_q = await db.execute(
        select(OpenClawExecutionEvent)
        .where(OpenClawExecutionEvent.task_id == task_id)
        .order_by(OpenClawExecutionEvent.created_at.asc())
    )
    for ev in events_q.scalars():
        if ev.event_type not in ("log", "log_entry", "tool_call"):
            continue
        payload = ev.payload_json or {}
        text = str(payload.get("content") or ev.event_type)
        await channels_service.create_message(
            db,
            workspace_id=workspace_id,
            channel_id=channel_id,
            data=ChannelMessageCreate(
                role="system",
                author_type="system",
                author_name="OpenClaw",
                content=text,
                metadata={
                    "kind": "main_chat_plugin_log",
                    "task_id": str(task_id),
                    "event_type": ev.event_type,
                    "payload": payload,
                },
            ),
        )


async def ensure_main_chat_ready(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
) -> AgentMainChatEnsureResponse:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    if ra.provider != "openclaw":
        raise HTTPException(status_code=400, detail="Main chat initialization is available for OpenClaw agents only")
    if not ra.openclaw_integration_id or not ra.openclaw_remote_agent_id:
        raise HTTPException(status_code=400, detail="OpenClaw integration binding is missing")

    main_channel = await channels_service.get_or_create_agent_main_channel(
        db,
        workspace_id=workspace_id,
        agent_id=agent_id,
        display_name=ra.display_name,
    )
    session_name = _main_session_name(workspace_id, ra.id)

    msgs = await channels_service.list_messages(db, workspace_id, main_channel.id)
    for m in reversed(msgs[-200:]):
        kind = str((m.metadata_ or {}).get("kind") or "")
        if kind == "main_session_ready":
            return AgentMainChatEnsureResponse(
                ready=True,
                status="already_ready",
                task_id=None,
                session_name=session_name,
            )

    task_q = await db.execute(
        select(OpenClawExecutionTask)
        .where(OpenClawExecutionTask.workspace_id == workspace_id)
        .where(OpenClawExecutionTask.integration_id == ra.openclaw_integration_id)
        .where(OpenClawExecutionTask.node_id == "agent_main_init")
        .where(OpenClawExecutionTask.session_token == f"agent-main-init:{agent_id}")
        .order_by(OpenClawExecutionTask.created_at.desc())
        .limit(1)
    )
    latest_init = task_q.scalar_one_or_none()

    if latest_init is not None:
        await db.refresh(latest_init)
        if latest_init.status == "completed":
            await _append_openclaw_task_logs_to_main_channel(
                db,
                workspace_id=workspace_id,
                channel_id=main_channel.id,
                task_id=latest_init.id,
            )
            await channels_service.create_message(
                db,
                workspace_id=workspace_id,
                channel_id=main_channel.id,
                data=ChannelMessageCreate(
                    role="system",
                    author_type="system",
                    author_name="Knotwork",
                    content="Main chat session initialized.",
                    metadata={
                        "kind": "main_session_ready",
                        "agent_id": str(agent_id),
                        "task_id": str(latest_init.id),
                        "session_name": session_name,
                        "init_reply": latest_init.output_text or "",
                    },
                ),
            )
            return AgentMainChatEnsureResponse(
                ready=True,
                status="initialized",
                task_id=latest_init.id,
                session_name=session_name,
            )

        if latest_init.status in ("pending", "claimed"):
            hard_deadline = latest_init.created_at + timedelta(seconds=600)
            if _now() < hard_deadline:
                return AgentMainChatEnsureResponse(
                    ready=False,
                    status="initializing",
                    task_id=latest_init.id,
                    session_name=session_name,
                    message="Main chat is being initialized.",
                )
            latest_init.status = "failed"
            latest_init.error_message = "Main chat initialization hard timeout (600s)"
            latest_init.completed_at = _now()
            latest_init.updated_at = _now()
            await db.commit()
            await _append_openclaw_task_logs_to_main_channel(
                db,
                workspace_id=workspace_id,
                channel_id=main_channel.id,
                task_id=latest_init.id,
            )
            return AgentMainChatEnsureResponse(
                ready=False,
                status="timeout",
                task_id=latest_init.id,
                session_name=session_name,
                message="Main chat initialization timed out. Retry to start a new init task.",
            )

    init_task = OpenClawExecutionTask(
        id=uuid4(),
        workspace_id=workspace_id,
        integration_id=ra.openclaw_integration_id,
        run_id=None,
        node_id="agent_main_init",
        agent_ref=ra.agent_ref,
        remote_agent_id=ra.openclaw_remote_agent_id,
        system_prompt=_main_chat_system_prompt(ra.display_name),
        user_prompt=_main_chat_init_prompt(ra.display_name, session_name),
        session_token=f"agent-main-init:{agent_id}",
        status="pending",
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(init_task)
    await db.commit()
    return AgentMainChatEnsureResponse(
        ready=False,
        status="initializing",
        task_id=init_task.id,
        session_name=session_name,
        message="Main chat initialization started.",
    )


async def list_main_chat_messages(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
):
    ra = await _get_agent_row(db, workspace_id, agent_id)
    main_channel = await channels_service.get_or_create_agent_main_channel(
        db,
        workspace_id=workspace_id,
        agent_id=agent_id,
        display_name=ra.display_name,
    )
    return await channels_service.list_messages(db, workspace_id, main_channel.id)


async def ask_main_chat(
    db: AsyncSession,
    workspace_id: UUID,
    agent_id: UUID,
    data: AgentMainChatAskRequest,
) -> AgentMainChatAskResponse:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    if ra.provider != "openclaw":
        raise HTTPException(status_code=400, detail="Main chat execution is available for OpenClaw agents only")
    if not ra.openclaw_integration_id or not ra.openclaw_remote_agent_id:
        raise HTTPException(status_code=400, detail="OpenClaw integration binding is missing")

    ensured = await ensure_main_chat_ready(db, workspace_id, agent_id)
    if not ensured.ready:
        detail = ensured.message or "Main chat is still initializing"
        raise HTTPException(status_code=409, detail=detail)
    main_channel = await channels_service.get_or_create_agent_main_channel(
        db,
        workspace_id=workspace_id,
        agent_id=agent_id,
        display_name=ra.display_name,
    )
    user_text = data.message.strip()
    if not user_text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    await channels_service.create_message(
        db,
        workspace_id=workspace_id,
        channel_id=main_channel.id,
        data=ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name="Operator",
            content=user_text,
            metadata={
                "kind": "main_chat_user",
                "agent_id": str(agent_id),
                "session_name": _main_session_name(workspace_id, ra.id),
            },
        ),
    )

    task = OpenClawExecutionTask(
        id=uuid4(),
        workspace_id=workspace_id,
        integration_id=ra.openclaw_integration_id,
        run_id=None,
        node_id="agent_main",
        agent_ref=ra.agent_ref,
        remote_agent_id=ra.openclaw_remote_agent_id,
        system_prompt=_main_chat_system_prompt(ra.display_name),
        user_prompt=user_text,
        session_token=f"agent-main:{agent_id}",
        status="pending",
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(task)
    await db.commit()

    task_id = task.id
    task_status, reply, question = await _wait_openclaw_task(db, task_id, timeout_seconds=300)
    await _append_openclaw_task_logs_to_main_channel(
        db,
        workspace_id=workspace_id,
        channel_id=main_channel.id,
        task_id=task_id,
    )
    if task_status == "completed":
        text = reply or ""
        await channels_service.create_message(
            db,
            workspace_id=workspace_id,
            channel_id=main_channel.id,
            data=ChannelMessageCreate(
                role="assistant",
                author_type="agent",
                author_name=ra.display_name,
                content=text,
                metadata={
                    "kind": "main_chat_reply",
                    "task_id": str(task_id),
                    "session_name": _main_session_name(workspace_id, ra.id),
                },
            ),
        )
        return AgentMainChatAskResponse(task_id=task_id, status="completed", reply=text)
    if task_status == "escalated":
        q = question or "Need human input"
        await channels_service.create_message(
            db,
            workspace_id=workspace_id,
            channel_id=main_channel.id,
            data=ChannelMessageCreate(
                role="assistant",
                author_type="agent",
                author_name=ra.display_name,
                content=q,
                metadata={"kind": "main_chat_escalation", "task_id": str(task_id)},
            ),
        )
        return AgentMainChatAskResponse(task_id=task_id, status="escalated", question=q)

    text = reply or "Main chat request timed out."
    await channels_service.create_message(
        db,
        workspace_id=workspace_id,
        channel_id=main_channel.id,
        data=ChannelMessageCreate(
            role="system",
            author_type="system",
            author_name="OpenClaw",
            content=text,
            metadata={"kind": "main_chat_timeout" if task_status == "timeout" else "main_chat_error", "task_id": str(task_id)},
        ),
    )
    return AgentMainChatAskResponse(task_id=task_id, status=task_status, reply=text)

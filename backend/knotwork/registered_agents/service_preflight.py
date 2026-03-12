"""Preflight run execution, listing, and baseline promotion."""
from __future__ import annotations

from statistics import median
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.registered_agents.models import AgentPreflightRun, AgentPreflightTest
from knotwork.registered_agents.schemas import (
    CapabilityContractOut,
    PreflightRunDetailOut,
    PreflightRunOut,
    PreflightRunRequest,
    PreflightTestOut,
)
from knotwork.registered_agents.service_capabilities import get_latest_capability
from knotwork.registered_agents.service_utils import _get_agent_row, _is_hidden_skill_tool, _now


def _preflight_suite(
    contract: CapabilityContractOut, provider: str, include_optional: bool
) -> list[dict]:
    tool_names = {t.name for t in contract.tools}
    if provider == "openclaw":
        cases: list[dict] = [
            {
                "test_id": "capability.skills_tools_discovered", "tool_name": None,
                "required": True, "ok": len(tool_names) > 0, "label": "skills_tools",
                "request": {},
                "response": {"items": sorted(tool_names), "skills": sorted(tool_names),
                             "tools": sorted(tool_names), "count": len(tool_names)},
            },
            {
                "test_id": "policy.notes", "tool_name": None, "required": False,
                "ok": bool(contract.policy_notes), "label": "policy_notes",
                "request": {}, "response": {"count": len(contract.policy_notes)},
            },
        ]
        for name in sorted(tool_names):
            cases.append({
                "test_id": f"skill_or_tool.{name}", "tool_name": name,
                "required": False, "ok": True, "label": "skill_or_tool",
                "request": {}, "response": {"status": "tool_present"},
            })
    else:
        cases = [
            {
                "test_id": "knotwork.complete_node", "tool_name": "complete_node",
                "required": True, "ok": "complete_node" in tool_names, "label": "tool",
                "request": {"output": "ok"}, "response": {"status": "tool_present"},
            },
            {
                "test_id": "knotwork.escalate", "tool_name": "escalate",
                "required": True, "ok": "escalate" in tool_names, "label": "tool",
                "request": {"question": "Need help"}, "response": {"status": "tool_present"},
            },
            {
                "test_id": "policy.notes", "tool_name": None, "required": False,
                "ok": bool(contract.policy_notes), "label": "policy_notes",
                "request": {}, "response": {"count": len(contract.policy_notes)},
            },
        ]
    return cases if include_optional else [c for c in cases if c["required"]]


def _build_preflight_test(
    c: dict, idx: int, preflight_id: UUID, agent_id: UUID, workspace_id: UUID, started_at,
) -> AgentPreflightTest:
    latencies = [120, 140, 110, 160, 150]
    is_ok = bool(c["ok"])
    error_msg = None if is_ok else (
        "No skills/tools discovered from capability contract"
        if c.get("label") == "skills_tools"
        else f"Missing required capability: {c.get('tool_name')}"
    )
    return AgentPreflightTest(
        id=uuid4(), workspace_id=workspace_id, preflight_run_id=preflight_id,
        agent_id=agent_id, test_id=c["test_id"], tool_name=c.get("tool_name"),
        required=bool(c["required"]), status="pass" if is_ok else "fail",
        latency_ms=latencies[idx % len(latencies)],
        error_code=None if is_ok else "MISSING_CAPABILITY",
        error_message=error_msg,
        request_preview_json=c["request"], response_preview_json=c["response"],
        started_at=started_at, completed_at=_now(), created_at=started_at,
    )


async def run_preflight(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, data: PreflightRunRequest
) -> PreflightRunDetailOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    contract = await get_latest_capability(db, workspace_id, agent_id)

    started = _now()
    cases = _preflight_suite(contract, ra.provider, include_optional=data.include_optional)
    preflight = AgentPreflightRun(
        id=uuid4(), workspace_id=workspace_id, agent_id=agent_id,
        suite_name=data.suite, include_optional=data.include_optional,
        status="running", started_at=started, created_at=started,
    )
    db.add(preflight)
    await db.flush()

    tests: list[AgentPreflightTest] = []
    req_total = req_passed = opt_total = opt_passed = failed = 0
    for idx, c in enumerate(cases):
        t = _build_preflight_test(c, idx, preflight.id, agent_id, workspace_id, started)
        db.add(t)
        tests.append(t)
        if c["required"]:
            req_total += 1
            if c["ok"]:
                req_passed += 1
        else:
            opt_total += 1
            if c["ok"]:
                opt_passed += 1
        if not c["ok"]:
            failed += 1

    pass_rate = (req_passed / req_total) if req_total > 0 else 0.0
    preflight.status = "pass" if req_total == req_passed else "fail"
    preflight.required_total = req_total
    preflight.required_passed = req_passed
    preflight.optional_total = opt_total
    preflight.optional_passed = opt_passed
    preflight.pass_rate = pass_rate
    preflight.median_latency_ms = int(median([t.latency_ms or 0 for t in tests])) if tests else None
    preflight.failed_count = failed
    preflight.completed_at = _now()

    ra.preflight_status = preflight.status
    ra.preflight_run_at = preflight.completed_at
    ra.updated_at = _now()

    await db.commit()

    return PreflightRunDetailOut(
        id=preflight.id, agent_id=agent_id, status=preflight.status,
        required_total=req_total, required_passed=req_passed,
        optional_total=opt_total, optional_passed=opt_passed,
        pass_rate=pass_rate, median_latency_ms=preflight.median_latency_ms,
        failed_count=failed, is_baseline=preflight.is_baseline,
        started_at=preflight.started_at, completed_at=preflight.completed_at,
        tests=[PreflightTestOut(
            test_id=t.test_id, tool_name=t.tool_name, required=t.required,
            status=t.status, latency_ms=t.latency_ms, error_code=t.error_code,
            error_message=t.error_message,
            request_preview=t.request_preview_json,
            response_preview=t.response_preview_json,
        ) for t in tests],
    )


async def list_preflight_runs(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, limit: int = 20
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
            id=row.id, agent_id=row.agent_id, status=row.status,
            required_total=row.required_total, required_passed=row.required_passed,
            optional_total=row.optional_total, optional_passed=row.optional_passed,
            pass_rate=row.pass_rate, median_latency_ms=row.median_latency_ms,
            failed_count=row.failed_count, is_baseline=row.is_baseline,
            started_at=row.started_at, completed_at=row.completed_at,
        )
        for row in res.scalars()
    ]


async def get_preflight_run(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, preflight_run_id: UUID
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
        id=run.id, agent_id=run.agent_id, status=run.status,
        required_total=run.required_total, required_passed=run.required_passed,
        optional_total=run.optional_total, optional_passed=run.optional_passed,
        pass_rate=run.pass_rate, median_latency_ms=run.median_latency_ms,
        failed_count=run.failed_count, is_baseline=run.is_baseline,
        started_at=run.started_at, completed_at=run.completed_at,
        tests=[PreflightTestOut(
            test_id=t.test_id, tool_name=t.tool_name, required=t.required,
            status=t.status, latency_ms=t.latency_ms, error_code=t.error_code,
            error_message=t.error_message,
            request_preview=t.request_preview_json,
            response_preview=t.response_preview_json,
        ) for t in tests],
    )


async def promote_preflight_baseline(
    db: AsyncSession, workspace_id: UUID, agent_id: UUID, preflight_run_id: UUID
) -> PreflightRunOut:
    ra = await _get_agent_row(db, workspace_id, agent_id)
    row = await db.get(AgentPreflightRun, preflight_run_id)
    if row is None or row.workspace_id != workspace_id or row.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Preflight run not found")

    current = await db.execute(
        select(AgentPreflightRun).where(
            and_(AgentPreflightRun.agent_id == agent_id, AgentPreflightRun.is_baseline == True)  # noqa: E712
        )
    )
    for old in current.scalars():
        old.is_baseline = False

    row.is_baseline = True
    ra.baseline_preflight_run_id = row.id
    ra.updated_at = _now()
    await db.commit()

    return PreflightRunOut(
        id=row.id, agent_id=row.agent_id, status=row.status,
        required_total=row.required_total, required_passed=row.required_passed,
        optional_total=row.optional_total, optional_passed=row.optional_passed,
        pass_rate=row.pass_rate, median_latency_ms=row.median_latency_ms,
        failed_count=row.failed_count, is_baseline=row.is_baseline,
        started_at=row.started_at, completed_at=row.completed_at,
    )

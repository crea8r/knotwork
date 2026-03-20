"""Shared helpers for registered_agents service modules."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.registered_agents.models import RegisteredAgent
from knotwork.registered_agents.schemas import RegisteredAgentOut


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
        bio=getattr(ra, "bio", None),
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
        openclaw_integration_id=getattr(ra, "openclaw_integration_id", None),
        openclaw_remote_agent_id=getattr(ra, "openclaw_remote_agent_id", None),
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
    return [t for t in tools if t.get("name") and not _is_hidden_skill_tool(str(t["name"]))]


def _hash_contract(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return f"sha256:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()}"


async def _get_agent_row(db: AsyncSession, workspace_id: UUID, agent_id: UUID) -> RegisteredAgent:
    ra = await db.get(RegisteredAgent, agent_id)
    if ra is None or ra.workspace_id != workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")
    return ra

from __future__ import annotations

import asyncio
import json
import secrets
import time
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from libs.config import settings
from core.api import runs as core_runs
from ..graphs.models import Graph, GraphVersion
from .models import PublicRunShare
from .run_notify import (  # noqa: F401 — re-exported
    notify_public_run_aborted,
    notify_public_run_completion,
)
from .slugs import ensure_graph_slug, generate_public_slug
from ..runs.models import Run
from ..runs.schemas import RunCreate


RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 5

_RATE_LIMIT_LOCK = asyncio.Lock()
_RATE_LIMIT_BUCKETS: dict[str, list[float]] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(24)}"


def _public_run_url(token: str) -> str:
    base = settings.normalized_frontend_url
    return f"{base}/public/runs/{token}"


def _normalize_email(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if "@" not in cleaned or "." not in cleaned.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Invalid email")
    return cleaned


def _coerce_output_text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("text", "final_output", "output", "result"):
            v = value.get(key)
            if isinstance(v, str):
                return v
        return json.dumps(value, ensure_ascii=False, indent=2)
    if isinstance(value, (list, tuple)):
        return json.dumps(value, ensure_ascii=False, indent=2)
    return str(value)


def _parse_client_ip(xff_header: str | None, fallback: str | None) -> str:
    if xff_header:
        first = xff_header.split(",")[0].strip()
        if first:
            return first
    return fallback or "unknown"


def _has_meaningful_input_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _validate_input_against_schema(input_schema: list[dict], payload: dict, context_file_count: int = 0) -> None:
    if not input_schema:
        return
    has_required_fields = any(bool(field.get("required", True)) for field in input_schema)
    if not has_required_fields and context_file_count > 0:
        meaningful_values = False
        for field in input_schema:
            name = str(field.get("name") or "").strip()
            if name and _has_meaningful_input_value(payload.get(name)):
                meaningful_values = True
                break
        if not meaningful_values:
            return
    for field in input_schema:
        name = str(field.get("name") or "").strip()
        if not name:
            continue
        required = bool(field.get("required", True))
        field_type = str(field.get("type") or "text")
        value = payload.get(name)
        if required and (value is None or (isinstance(value, str) and not value.strip())):
            raise HTTPException(status_code=400, detail=f"Missing required field: {name}")
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if field_type in ("text", "textarea") and not isinstance(value, str):
            raise HTTPException(status_code=400, detail=f"Field '{name}' must be a string")
        if field_type == "number" and not isinstance(value, (int, float)):
            raise HTTPException(status_code=400, detail=f"Field '{name}' must be a number")


async def _fetch_graph_in_workspace(db: AsyncSession, workspace_id: UUID, graph_id: UUID) -> Graph:
    graph = await db.get(Graph, graph_id)
    if graph is None or graph.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Graph not found")
    return graph


async def _fetch_named_version(db: AsyncSession, graph_id: UUID, version_id: UUID) -> GraphVersion:
    version = await db.get(GraphVersion, version_id)
    if version is None or version.graph_id != graph_id or version.version_id is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return version


async def publish_version(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
    version_id: UUID,
    description_md: str,
) -> GraphVersion:
    graph = await _fetch_graph_in_workspace(db, workspace_id, graph_id)
    version = await _fetch_named_version(db, graph_id, version_id)
    if version.version_slug is None:
        version.version_slug = generate_public_slug(version.version_name or "version")
    version.public_description_md = description_md.strip()
    await ensure_graph_slug(db, graph)
    await db.commit()
    await db.refresh(version)
    return version


async def unpublish_version(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
    version_id: UUID,
) -> GraphVersion:
    await _fetch_graph_in_workspace(db, workspace_id, graph_id)
    version = await _fetch_named_version(db, graph_id, version_id)
    version.version_slug = None
    version.public_description_md = None
    await db.commit()
    await db.refresh(version)
    return version


async def enforce_trigger_rate_limit(rate_key: str, ip: str) -> None:
    now = time.monotonic()
    bucket_key = f"{rate_key}:{ip}"
    async with _RATE_LIMIT_LOCK:
        entries = _RATE_LIMIT_BUCKETS.get(bucket_key, [])
        cutoff = now - RATE_LIMIT_WINDOW_SECONDS
        entries = [ts for ts in entries if ts >= cutoff]
        if len(entries) >= RATE_LIMIT_MAX_REQUESTS:
            _RATE_LIMIT_BUCKETS[bucket_key] = entries
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Try again later ({RATE_LIMIT_MAX_REQUESTS}/{RATE_LIMIT_WINDOW_SECONDS}s).",
            )
        entries.append(now)
        _RATE_LIMIT_BUCKETS[bucket_key] = entries


async def trigger_public_run(
    db: AsyncSession,
    graph: Graph,
    version: GraphVersion,
    input_payload: dict,
    email: str | None,
    context_files: list[dict],
    rate_key: str,
    client_ip: str,
) -> PublicRunShare:
    await enforce_trigger_rate_limit(rate_key, client_ip)
    definition = version.definition if isinstance(version.definition, dict) else {}
    input_schema = definition.get("input_schema", []) if isinstance(definition, dict) else []
    _validate_input_against_schema(
        input_schema if isinstance(input_schema, list) else [],
        input_payload,
        context_file_count=len(context_files or []),
    )
    run = await core_runs.create_run(
        db,
        workspace_id=graph.workspace_id,
        graph_id=graph.id,
        data=RunCreate(input=input_payload, trigger="public", context_files=context_files, name=None),
        created_by=None,
        force_graph_version_id=version.id,
        trigger_meta={"public_version_slug": version.version_slug or "", "client_ip": client_ip},
    )
    share = PublicRunShare(
        id=uuid4(),
        workspace_id=graph.workspace_id,
        run_id=run.id,
        graph_version_id=version.id,
        token=_new_token("kwpubrun"),
        description_md=version.public_description_md or "",
        email=_normalize_email(email),
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    return share


async def get_public_run_view(db: AsyncSession, token: str) -> tuple[PublicRunShare, Run, str | None]:
    rows = await db.execute(select(PublicRunShare).where(PublicRunShare.token == token))
    share = rows.scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=404, detail="Not found")
    run = await db.get(Run, share.run_id)
    if run is None or run.workspace_id != share.workspace_id:
        raise HTTPException(status_code=404, detail="Not found")
    return share, run, _coerce_output_text(run.output)


async def set_public_run_email(db: AsyncSession, token: str, email: str) -> PublicRunShare:
    email_norm = _normalize_email(email)
    if not email_norm:
        raise HTTPException(status_code=400, detail="Invalid email")
    rows = await db.execute(select(PublicRunShare).where(PublicRunShare.token == token))
    share = rows.scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=404, detail="Not found")
    share.email = email_norm
    await db.commit()
    await db.refresh(share)
    return share


def rate_limit_meta() -> tuple[int, int]:
    return (RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS)


def client_ip_from_headers(x_forwarded_for: str | None, request_client_host: str | None) -> str:
    return _parse_client_ip(x_forwarded_for, request_client_host)

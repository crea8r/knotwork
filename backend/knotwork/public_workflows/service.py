from __future__ import annotations

import asyncio
import json
import secrets
import time
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.config import settings
from knotwork.graphs.models import Graph, GraphVersion
from knotwork.notifications.channels.email import send as send_email
from knotwork.public_workflows.models import PublicRunShare, PublicWorkflowLink
from knotwork.runs.models import Run
from knotwork.runs.schemas import RunCreate
from knotwork.runs.service import create_run


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
    # Basic MVP check only (full verification is out of scope).
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


def _validate_input_against_schema(input_schema: list[dict], payload: dict) -> None:
    if not input_schema:
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

        if value is None:
            continue
        if field_type in ("text", "textarea") and not isinstance(value, str):
            raise HTTPException(status_code=400, detail=f"Field '{name}' must be a string")
        if field_type == "number":
            if not isinstance(value, (int, float)):
                raise HTTPException(status_code=400, detail=f"Field '{name}' must be a number")


async def _fetch_graph_in_workspace(db: AsyncSession, workspace_id: UUID, graph_id: UUID) -> Graph:
    graph = await db.get(Graph, graph_id)
    if graph is None or graph.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Graph not found")
    return graph


async def _fetch_graph_version_for_link(
    db: AsyncSession,
    graph_id: UUID,
    graph_version_id: UUID | None,
) -> GraphVersion:
    if graph_version_id is not None:
        version = await db.get(GraphVersion, graph_version_id)
        if version is None or version.graph_id != graph_id:
            raise HTTPException(status_code=400, detail="Invalid graph_version_id")
        return version

    row = await db.execute(
        select(GraphVersion)
        .where(GraphVersion.graph_id == graph_id)
        .order_by(GraphVersion.created_at.desc())
        .limit(1)
    )
    version = row.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=400, detail="Graph has no versions")
    return version


async def list_public_links(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
) -> list[PublicWorkflowLink]:
    await _fetch_graph_in_workspace(db, workspace_id, graph_id)
    rows = await db.execute(
        select(PublicWorkflowLink)
        .where(
            PublicWorkflowLink.workspace_id == workspace_id,
            PublicWorkflowLink.graph_id == graph_id,
        )
        .order_by(PublicWorkflowLink.created_at.desc())
    )
    return list(rows.scalars())


async def create_public_link(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
    graph_version_id: UUID | None,
    description_md: str,
    created_by: UUID | None,
) -> PublicWorkflowLink:
    await _fetch_graph_in_workspace(db, workspace_id, graph_id)
    if graph_version_id is not None:
        await _fetch_graph_version_for_link(db, graph_id, graph_version_id)

    row = PublicWorkflowLink(
        id=uuid4(),
        workspace_id=workspace_id,
        graph_id=graph_id,
        graph_version_id=graph_version_id,
        token=_new_token("kwpubwf"),
        description_md=description_md.strip(),
        status="active",
        created_by=created_by,
        updated_at=_now(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def update_public_link(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
    link_id: UUID,
    graph_version_id: UUID | None,
    description_md: str,
) -> PublicWorkflowLink:
    await _fetch_graph_in_workspace(db, workspace_id, graph_id)
    row = await db.get(PublicWorkflowLink, link_id)
    if row is None or row.workspace_id != workspace_id or row.graph_id != graph_id:
        raise HTTPException(status_code=404, detail="Public link not found")

    if graph_version_id is not None:
        await _fetch_graph_version_for_link(db, graph_id, graph_version_id)

    row.graph_version_id = graph_version_id
    row.description_md = description_md.strip()
    row.updated_at = _now()
    await db.commit()
    await db.refresh(row)
    return row


async def disable_public_link(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
    link_id: UUID,
) -> PublicWorkflowLink:
    await _fetch_graph_in_workspace(db, workspace_id, graph_id)
    row = await db.get(PublicWorkflowLink, link_id)
    if row is None or row.workspace_id != workspace_id or row.graph_id != graph_id:
        raise HTTPException(status_code=404, detail="Public link not found")
    row.status = "disabled"
    row.updated_at = _now()
    await db.commit()
    await db.refresh(row)
    return row


async def _get_active_link_by_token(db: AsyncSession, token: str) -> PublicWorkflowLink:
    rows = await db.execute(
        select(PublicWorkflowLink).where(
            and_(
                PublicWorkflowLink.token == token,
                PublicWorkflowLink.status == "active",
            )
        )
    )
    row = rows.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return row


async def enforce_trigger_rate_limit(token: str, ip: str) -> None:
    now = time.monotonic()
    bucket_key = f"{token}:{ip}"
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


async def get_public_workflow_view(db: AsyncSession, token: str) -> tuple[PublicWorkflowLink, GraphVersion]:
    link = await _get_active_link_by_token(db, token)
    version = await _fetch_graph_version_for_link(db, link.graph_id, link.graph_version_id)
    return link, version


async def trigger_public_run(
    db: AsyncSession,
    token: str,
    input_payload: dict,
    email: str | None,
    client_ip: str,
) -> PublicRunShare:
    await enforce_trigger_rate_limit(token, client_ip)
    link, version = await get_public_workflow_view(db, token)
    definition = version.definition if isinstance(version.definition, dict) else {}
    input_schema = definition.get("input_schema", []) if isinstance(definition, dict) else []
    _validate_input_against_schema(input_schema if isinstance(input_schema, list) else [], input_payload)

    run = await create_run(
        db,
        workspace_id=link.workspace_id,
        graph_id=link.graph_id,
        data=RunCreate(
            input=input_payload,
            trigger="public",
            context_files=[],
            name=None,
        ),
        created_by=None,
        force_graph_version_id=version.id,
        trigger_meta={
            "public_workflow_link_id": str(link.id),
            "public_workflow_token_prefix": link.token[:12],
            "client_ip": client_ip,
        },
    )

    share = PublicRunShare(
        id=uuid4(),
        workspace_id=link.workspace_id,
        run_id=run.id,
        public_workflow_id=link.id,
        token=_new_token("kwpubrun"),
        description_md=link.description_md,
        email=_normalize_email(email),
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    return share


async def _extract_run_final_output(db: AsyncSession, run: Run) -> str | None:
    return _coerce_output_text(run.output)


async def get_public_run_view(db: AsyncSession, token: str) -> tuple[PublicRunShare, Run, str | None]:
    rows = await db.execute(select(PublicRunShare).where(PublicRunShare.token == token))
    share = rows.scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=404, detail="Not found")

    run = await db.get(Run, share.run_id)
    if run is None or run.workspace_id != share.workspace_id:
        raise HTTPException(status_code=404, detail="Not found")

    final_output = await _extract_run_final_output(db, run)
    return share, run, final_output


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


async def notify_public_run_completion(db: AsyncSession, run_id: UUID) -> None:
    rows = await db.execute(
        select(PublicRunShare)
        .where(
            PublicRunShare.run_id == run_id,
            PublicRunShare.email.is_not(None),
            PublicRunShare.notified_at.is_(None),
        )
        .order_by(PublicRunShare.created_at.asc())
    )
    shares = list(rows.scalars())
    if not shares:
        return

    run = await db.get(Run, run_id)
    if run is None:
        return
    final_output = await _extract_run_final_output(db, run)
    if not final_output:
        return

    for share in shares:
        to_email = (share.email or "").strip()
        if not to_email:
            continue
        try:
            await send_email(
                to_address=to_email,
                subject="[Knotwork] Your public workflow result is ready",
                body=(
                    "Your workflow run has completed.\n\n"
                    f"Open result: {_public_run_url(share.token)}\n\n"
                    "This was generated from a public test workflow page."
                ),
                from_address=settings.email_from,
            )
            share.notified_at = _now()
        except Exception:
            # Best-effort for MVP. Keep retries possible by leaving notified_at null.
            continue

    await db.commit()


async def notify_public_run_aborted(db: AsyncSession, run_id: UUID) -> None:
    rows = await db.execute(
        select(PublicRunShare)
        .where(
            PublicRunShare.run_id == run_id,
            PublicRunShare.email.is_not(None),
            PublicRunShare.notified_at.is_(None),
        )
        .order_by(PublicRunShare.created_at.asc())
    )
    shares = list(rows.scalars())
    if not shares:
        return

    run = await db.get(Run, run_id)
    if run is None or run.status != "stopped":
        return

    for share in shares:
        to_email = (share.email or "").strip()
        if not to_email:
            continue
        try:
            await send_email(
                to_address=to_email,
                subject="[Knotwork] Your public workflow run was aborted",
                body=(
                    "Your workflow run was aborted before final output was produced.\n\n"
                    f"Open run page: {_public_run_url(share.token)}\n\n"
                    "You can retrigger from the public workflow page if needed."
                ),
                from_address=settings.email_from,
            )
            share.notified_at = _now()
        except Exception:
            # Best-effort for MVP. Keep retries possible by leaving notified_at null.
            continue

    await db.commit()


def rate_limit_meta() -> tuple[int, int]:
    return (RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS)


def client_ip_from_headers(x_forwarded_for: str | None, request_client_host: str | None) -> str:
    return _parse_client_ip(x_forwarded_for, request_client_host)

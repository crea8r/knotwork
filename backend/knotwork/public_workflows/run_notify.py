"""Email notification helpers for public run completion/abort."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.config import settings
from knotwork.notifications.channels.email import send as send_email
from knotwork.public_workflows.models import PublicRunShare
from knotwork.runs.models import Run


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _public_run_url(token: str) -> str:
    base = settings.normalized_frontend_url
    return f"{base}/public/runs/{token}"


def _coerce_output_text(value: object) -> str | None:
    import json
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


async def _extract_run_final_output(run: Run) -> str | None:
    return _coerce_output_text(run.output)


async def notify_public_run_completion(db: AsyncSession, run_id: str) -> None:
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
    final_output = await _extract_run_final_output(run)
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
            continue
    await db.commit()


async def notify_public_run_aborted(db: AsyncSession, run_id: str) -> None:
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
            continue
    await db.commit()

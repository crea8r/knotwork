from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.graphs.service import get_graph, get_latest_version
from knotwork.runs.models import OpenAICallLog, Run, RunHandbookProposal, RunNodeState, RunWorklogEntry
from knotwork.runs.schemas import RunCreate, RunUpdate

# Hard-delete is allowed for non-running runs.
# Active execution must be stopped via POST /runs/{run_id}/abort first.
DELETABLE_STATUSES = {"completed", "failed", "stopped", "draft", "queued", "paused"}
MAX_RUN_ATTACHMENTS = 10
MAX_RUN_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024


def _normalize_context_files(context_files: list) -> list[dict]:
    normalized: list[dict] = []
    for raw in context_files or []:
        if not isinstance(raw, dict):
            raise ValueError("Invalid context_files payload")
        filename = str(raw.get("filename") or "").strip()
        key = str(raw.get("key") or "").strip()
        url = str(raw.get("url") or "").strip()
        mime_type = str(raw.get("mime_type") or "").strip() or "application/octet-stream"
        attachment_id = str(raw.get("attachment_id") or "").strip()
        size_raw = raw.get("size")
        try:
            size = int(size_raw)
        except (TypeError, ValueError):
            raise ValueError(f"Invalid size for attachment '{filename or key or 'unknown'}'")

        if not filename or not key or not url or not attachment_id:
            raise ValueError("Each attachment must include key, url, filename, and attachment_id")
        if size <= 0:
            raise ValueError(f"Attachment '{filename}' is empty")
        if size > MAX_RUN_ATTACHMENT_SIZE_BYTES:
            raise ValueError(f"Attachment '{filename}' exceeds 10 MB limit")

        normalized.append({
            "type": "run_attachment",
            "key": key,
            "url": url,
            "filename": filename,
            "mime_type": mime_type,
            "size": size,
            "attachment_id": attachment_id,
        })

    if len(normalized) > MAX_RUN_ATTACHMENTS:
        raise ValueError("Too many attachments (max 10)")
    return normalized


async def create_run(
    db: AsyncSession,
    workspace_id: UUID,
    graph_id: UUID,
    data: RunCreate,
    created_by: UUID | None = None,
    force_graph_version_id: UUID | None = None,
    trigger_meta: dict | None = None,
) -> Run:
    from knotwork.runtime.validation import validate_graph

    graph = await get_graph(db, graph_id)
    if not graph:
        raise ValueError("Graph not found")

    if force_graph_version_id is not None:
        from knotwork.graphs.models import GraphVersion

        version = await db.get(GraphVersion, force_graph_version_id)
        if version is None or version.graph_id != graph_id:
            raise ValueError("Invalid graph version")
    else:
        version = await get_latest_version(db, graph_id)
        if not version:
            raise ValueError("Graph has no versions")

    errors = validate_graph(version.definition)
    if errors:
        raise ValueError("; ".join(errors))

    context_files = _normalize_context_files(data.context_files)

    run = Run(
        workspace_id=workspace_id,
        graph_id=graph_id,
        graph_version_id=version.id,
        name=data.name,
        input=data.input,
        context_files=context_files,
        trigger=data.trigger,
        trigger_meta=trigger_meta,
        created_by=created_by,
        status="queued",
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    from knotwork.channels import service as channel_service
    from knotwork.channels.schemas import ChannelMessageCreate

    run_channel = await channel_service.get_or_create_run_channel(
        db,
        workspace_id=workspace_id,
        run_id=run.id,
        graph_id=graph_id,
    )
    await channel_service.create_message(
        db,
        workspace_id=workspace_id,
        channel_id=run_channel.id,
        data=ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name="You",
            content=f"Run started.\nInput: {run.input}",
            run_id=run.id,
            metadata={"kind": "run_start"},
        ),
    )

    from arq import create_pool
    from arq.connections import RedisSettings
    from knotwork.config import settings

    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("execute_run", run_id=str(run.id))
        await redis.aclose()
    except Exception:
        # Keep API successful even if queue is temporarily unavailable.
        # Run stays queued until worker/queue recovers or execute endpoint is used.
        pass

    return run


async def get_run(db: AsyncSession, run_id: UUID) -> Run | None:
    return await db.get(Run, run_id)


async def update_run(db: AsyncSession, run_id: UUID, data: RunUpdate) -> Run | None:
    run = await db.get(Run, run_id)
    if not run:
        return None
    if data.name is not None:
        run.name = data.name
    if data.input is not None:
        if run.status != "draft":
            raise ValueError("Input can only be changed on draft runs")
        run.input = data.input
    await db.commit()
    await db.refresh(run)
    return run


async def list_run_node_states(db: AsyncSession, run_id: UUID) -> list[RunNodeState]:
    result = await db.execute(
        select(RunNodeState).where(RunNodeState.run_id == run_id)
    )
    return list(result.scalars())


async def list_workspace_runs(db: AsyncSession, workspace_id: UUID) -> list[dict]:
    """Return runs enriched with total_tokens, output_summary, needs_attention."""
    runs_q = await db.execute(
        select(Run)
        .where(Run.workspace_id == workspace_id)
        .order_by(Run.created_at.desc())
        .limit(50)
    )
    runs = list(runs_q.scalars())
    if not runs:
        return []

    run_ids = [r.id for r in runs]

    tok_q = await db.execute(
        select(RunNodeState.run_id, func.sum(RunNodeState.resolved_token_count).label("total"))
        .where(RunNodeState.run_id.in_(run_ids))
        .group_by(RunNodeState.run_id)
    )
    tok_map: dict = {row.run_id: row.total for row in tok_q}

    nodes_q = await db.execute(
        select(RunNodeState)
        .where(RunNodeState.run_id.in_(run_ids), RunNodeState.status == "completed")
        .order_by(RunNodeState.completed_at.desc())
    )
    seen: set = set()
    out_map: dict = {}
    for ns in nodes_q.scalars():
        if ns.run_id not in seen:
            seen.add(ns.run_id)
            if isinstance(ns.output, dict) and isinstance(ns.output.get("text"), str):
                out_map[ns.run_id] = ns.output["text"][:200]

    result = []
    for r in runs:
        result.append({
            **{c.key: getattr(r, c.key) for c in r.__table__.columns},
            "total_tokens": tok_map.get(r.id),
            "output_summary": out_map.get(r.id),
            "needs_attention": r.status == "paused",
            "error": r.error,
        })
    return result


async def clone_run_as_draft(db: AsyncSession, run_id: UUID) -> Run:
    source = await db.get(Run, run_id)
    if not source:
        raise ValueError("Run not found")
    version = await get_latest_version(db, source.graph_id)
    if not version:
        raise ValueError("Graph has no versions")
    draft = Run(
        workspace_id=source.workspace_id,
        graph_id=source.graph_id,
        graph_version_id=version.id,
        input=source.input,
        context_files=source.context_files,
        trigger="manual",
        status="draft",
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return draft


async def list_worklog(db: AsyncSession, run_id: UUID) -> list[RunWorklogEntry]:
    result = await db.execute(
        select(RunWorklogEntry)
        .where(RunWorklogEntry.run_id == run_id)
        .order_by(RunWorklogEntry.created_at)
    )
    return list(result.scalars())


async def list_proposals(db: AsyncSession, run_id: UUID) -> list[RunHandbookProposal]:
    result = await db.execute(
        select(RunHandbookProposal)
        .where(RunHandbookProposal.run_id == run_id)
        .order_by(RunHandbookProposal.created_at)
    )
    return list(result.scalars())


async def list_openai_logs(db: AsyncSession, run_id: UUID) -> list[OpenAICallLog]:
    result = await db.execute(
        select(OpenAICallLog)
        .where(OpenAICallLog.run_id == run_id)
        .order_by(OpenAICallLog.created_at.asc())
    )
    return list(result.scalars())


async def list_run_chat_messages(db: AsyncSession, run_id: UUID):
    from knotwork.channels.models import ChannelMessage

    result = await db.execute(
        select(ChannelMessage)
        .where(ChannelMessage.run_id == run_id)
        .order_by(ChannelMessage.created_at.asc())
    )
    return list(result.scalars())


async def delete_run(db: AsyncSession, run_id: UUID) -> None:
    """Hard-delete run and dependent records in FK-safe order."""
    run = await db.get(Run, run_id)
    if not run:
        return
    from knotwork.channels.models import ChannelMessage, DecisionEvent
    from knotwork.escalations.models import Escalation
    from knotwork.notifications.models import NotificationLog
    from knotwork.ratings.models import Rating

    # Best-effort cleanup of uploaded run attachments.
    from knotwork.knowledge.storage import get_storage_adapter
    storage = get_storage_adapter()
    for item in run.context_files or []:
        if not isinstance(item, dict):
            continue
        if str(item.get("type") or "") != "run_attachment":
            continue
        key = str(item.get("key") or "").strip()
        if not key:
            continue
        try:
            await storage.delete("_run_attachments", key)
        except Exception:
            # Keep delete_run robust: stale/missing attachment blobs should not
            # block removing the run itself.
            pass

    escalation_ids = list(
        (
            await db.execute(
                select(Escalation.id).where(Escalation.run_id == run_id)
            )
        ).scalars()
    )

    # Keep channel/decision history while removing hard FK links to the deleted run.
    await db.execute(
        update(ChannelMessage)
        .where(ChannelMessage.run_id == run_id)
        .values(run_id=None)
    )
    await db.execute(
        update(DecisionEvent)
        .where(DecisionEvent.run_id == run_id)
        .values(run_id=None)
    )

    if escalation_ids:
        await db.execute(
            update(DecisionEvent)
            .where(DecisionEvent.escalation_id.in_(escalation_ids))
            .values(escalation_id=None)
        )
        await db.execute(
            update(NotificationLog)
            .where(NotificationLog.escalation_id.in_(escalation_ids))
            .values(escalation_id=None)
        )
        await db.execute(
            delete(Escalation).where(Escalation.id.in_(escalation_ids))
        )

    await db.execute(delete(OpenAICallLog).where(OpenAICallLog.run_id == run_id))
    await db.execute(delete(Rating).where(Rating.run_id == run_id))
    await db.execute(delete(RunHandbookProposal).where(RunHandbookProposal.run_id == run_id))
    await db.execute(delete(RunWorklogEntry).where(RunWorklogEntry.run_id == run_id))
    await db.execute(delete(RunNodeState).where(RunNodeState.run_id == run_id))
    await db.delete(run)
    await db.commit()

"""
Knowledge file health scoring.

Composite score [0.0, 5.0] — weighted sum of three signals:

  token_score      (25%): ideal range 300–3 000 tokens
  confidence_score (40%): mean confidence of RunNodeState records that referenced the file
  escalation_score (35%): inverse of the escalation rate among those runs

Returns 0.0 when no run data exists for the file (cold-start).
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from modules.workflows.backend.runs.escalations_models import Escalation
from modules.workflows.backend.runs.models import Run, RunNodeState

from .knowledge_models import KnowledgeFile, KnowledgeHealthLog


def _token_score(count: int) -> float:
    """Map a token count to a [0.0, 5.0] quality score."""
    if count == 0:
        return 0.0
    if count < 300:
        return round(5.0 * count / 300, 2)
    if count <= 3000:
        return 5.0
    # Decay from 3 000 to 9 000, floor at 1.0
    return max(1.0, round(5.0 - 4.0 * (count - 3000) / 6000, 2))


async def compute_health_score(file_id: UUID, db: AsyncSession) -> float:
    """
    Compute and cache the composite health score for a knowledge file.

    Returns a float in [0.0, 5.0]. Returns 0.0 on cold-start (no runs yet).
    """
    file = await db.get(KnowledgeFile, file_id)
    if file is None:
        return 0.0

    path = str(file.path)
    ws_id = file.workspace_id

    # All RunNodeState records for this workspace
    result = await db.execute(
        select(RunNodeState)
        .join(Run, RunNodeState.run_id == Run.id)
        .where(Run.workspace_id == ws_id)
    )
    node_states = list(result.scalars().all())

    # Only those that actually used this file (path present in knowledge_snapshot)
    relevant = [
        ns for ns in node_states
        if ns.knowledge_snapshot and path in ns.knowledge_snapshot
    ]
    run_count = len(relevant)

    if run_count == 0:
        return 0.0

    # ── Token score ──────────────────────────────────────────────────────────
    token_score = _token_score(file.resolved_token_count or file.raw_token_count)

    # ── Confidence score: mean confidence × 5 ────────────────────────────────
    conf_vals = [ns.confidence_score for ns in relevant if ns.confidence_score is not None]
    confidence_score = round(sum(conf_vals) / len(conf_vals) * 5, 2) if conf_vals else 0.0

    # ── Escalation score: (1 − escalation_rate) × 5 ──────────────────────────
    relevant_ids = [ns.id for ns in relevant]
    esc_result = await db.execute(
        select(func.count(Escalation.id))
        .where(Escalation.run_node_state_id.in_(relevant_ids))
    )
    esc_count = int(esc_result.scalar() or 0)
    escalation_score = round(max(0.0, (1 - esc_count / run_count) * 5), 2)

    # ── Weighted composite ────────────────────────────────────────────────────
    composite = round(
        token_score * 0.25
        + confidence_score * 0.40
        + escalation_score * 0.35,
        2,
    )

    # Persist log entry + update cached field
    log = KnowledgeHealthLog(
        file_id=file.id,
        score=composite,
        token_score=token_score,
        confidence_score=confidence_score,
        escalation_score=escalation_score,
        rating_score=0.0,
        run_count=run_count,
    )
    db.add(log)
    file.health_score = composite
    await db.commit()

    return composite

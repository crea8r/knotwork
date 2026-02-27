"""
S3 tests: health score computation.
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from knotwork.knowledge.health import _token_score, compute_health_score


# ── Token score unit tests ────────────────────────────────────────────────────

def test_token_score_zero():
    assert _token_score(0) == 0.0


def test_token_score_sparse():
    """< 300 tokens → partial score."""
    score = _token_score(150)
    assert 0.0 < score < 5.0


def test_token_score_ideal():
    """300–3 000 tokens → perfect score."""
    assert _token_score(300) == 5.0
    assert _token_score(1000) == 5.0
    assert _token_score(3000) == 5.0


def test_token_score_large():
    """> 3 000 tokens → decaying score, never below 1.0."""
    score = _token_score(6000)
    assert 1.0 <= score < 5.0


def test_token_score_very_large():
    assert _token_score(100000) == 1.0


# ── compute_health_score integration tests ────────────────────────────────────

async def test_health_score_cold_start(db, workspace, tmp_storage):
    """File with no runs returns 0.0."""
    import knotwork.knowledge.service as svc_mod
    orig = svc_mod.get_storage_adapter
    svc_mod.get_storage_adapter = lambda: tmp_storage

    from knotwork.knowledge.models import KnowledgeFile
    kf = KnowledgeFile(
        workspace_id=workspace.id,
        path="shared/guide.md",
        title="Guide",
        raw_token_count=500,
        resolved_token_count=500,
        linked_paths=[],
    )
    db.add(kf)
    await db.commit()
    await db.refresh(kf)

    score = await compute_health_score(kf.id, db)
    assert score == 0.0

    svc_mod.get_storage_adapter = orig


async def test_health_score_file_not_found(db):
    """Non-existent file_id returns 0.0."""
    score = await compute_health_score(uuid4(), db)
    assert score == 0.0


async def test_health_score_with_runs(db, workspace, run):
    """File referenced in run data produces a non-zero composite score."""
    from knotwork.knowledge.models import KnowledgeFile
    from knotwork.runs.models import RunNodeState

    FILE_PATH = "shared/procedure.md"

    kf = KnowledgeFile(
        workspace_id=workspace.id,
        path=FILE_PATH,
        title="Procedure",
        raw_token_count=800,
        resolved_token_count=800,
        linked_paths=[],
    )
    db.add(kf)
    await db.flush()

    # RunNodeState referencing this file
    ns = RunNodeState(
        run_id=run.id,
        node_id="n1",
        status="completed",
        output={"text": "result"},
        confidence_score=0.9,
        knowledge_snapshot={FILE_PATH: "v1"},
    )
    db.add(ns)
    await db.commit()
    await db.refresh(kf)

    score = await compute_health_score(kf.id, db)
    # confidence 0.9 × 5 = 4.5 (30%), escalation = 5.0 (25%), rating = 0.0 (25%), token 5.0 (20%)
    # Expected ≈ 5.0×0.20 + 4.5×0.30 + 5.0×0.25 + 0.0×0.25 = 1.0 + 1.35 + 1.25 + 0.0 = 3.60
    assert 3.0 <= score <= 5.0


async def test_health_score_cached(db, workspace, run):
    """health_score field on KnowledgeFile is updated after compute."""
    from knotwork.knowledge.models import KnowledgeFile
    from knotwork.runs.models import RunNodeState

    FILE_PATH = "shared/cached.md"

    kf = KnowledgeFile(
        workspace_id=workspace.id,
        path=FILE_PATH,
        title="Cached",
        raw_token_count=600,
        resolved_token_count=600,
        linked_paths=[],
    )
    db.add(kf)
    await db.flush()

    ns = RunNodeState(
        run_id=run.id,
        node_id="n1",
        status="completed",
        output={},
        confidence_score=0.8,
        knowledge_snapshot={FILE_PATH: "v1"},
    )
    db.add(ns)
    await db.commit()
    await db.refresh(kf)

    score = await compute_health_score(kf.id, db)

    await db.refresh(kf)
    assert kf.health_score is not None
    assert abs(kf.health_score - score) < 0.01


async def test_health_score_with_escalation(db, workspace, run):
    """Escalations reduce the escalation_score component."""
    from knotwork.knowledge.models import KnowledgeFile
    from knotwork.runs.models import RunNodeState
    from knotwork.escalations.models import Escalation

    FILE_PATH = "shared/escalated.md"

    kf = KnowledgeFile(
        workspace_id=workspace.id,
        path=FILE_PATH,
        title="Escalated",
        raw_token_count=600,
        resolved_token_count=600,
        linked_paths=[],
    )
    db.add(kf)
    await db.flush()

    ns = RunNodeState(
        run_id=run.id,
        node_id="n1",
        status="escalated",
        output={},
        confidence_score=0.5,
        knowledge_snapshot={FILE_PATH: "v1"},
    )
    db.add(ns)
    await db.flush()

    esc = Escalation(
        run_id=run.id,
        run_node_state_id=ns.id,
        workspace_id=workspace.id,
        type="low_confidence",
        status="open",
        context={},
        assigned_to=[],
    )
    db.add(esc)
    await db.commit()
    await db.refresh(kf)

    score_with_esc = await compute_health_score(kf.id, db)
    # escalation_score = (1 - 1/1) * 5 = 0.0 → lowers composite
    assert score_with_esc < 4.5


async def test_health_score_with_rating(db, workspace, run):
    """High star rating raises the rating component."""
    from knotwork.knowledge.models import KnowledgeFile
    from knotwork.runs.models import RunNodeState
    from knotwork.ratings.models import Rating

    FILE_PATH = "shared/rated.md"

    kf = KnowledgeFile(
        workspace_id=workspace.id,
        path=FILE_PATH,
        title="Rated",
        raw_token_count=600,
        resolved_token_count=600,
        linked_paths=[],
    )
    db.add(kf)
    await db.flush()

    ns = RunNodeState(
        run_id=run.id,
        node_id="n1",
        status="completed",
        output={},
        confidence_score=0.9,
        knowledge_snapshot={FILE_PATH: "v1"},
    )
    db.add(ns)
    await db.flush()

    rating = Rating(
        run_id=run.id,
        run_node_state_id=ns.id,
        workspace_id=workspace.id,
        score=5,
    )
    db.add(rating)
    await db.commit()
    await db.refresh(kf)

    score = await compute_health_score(kf.id, db)
    # token 5.0×0.20=1.0, confidence 0.9×5=4.5×0.30=1.35, escalation 5.0×0.25=1.25, rating 5.0×0.25=1.25 → 4.85
    assert score >= 4.0

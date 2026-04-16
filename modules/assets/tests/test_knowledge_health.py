from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from modules.assets.backend.knowledge_health import _token_score, compute_health_score
from modules.assets.backend.knowledge_models import KnowledgeFile
from modules.workflows.backend.runs.escalations_models import Escalation
from modules.workflows.backend.runs.models import Run, RunNodeState


def test_token_score_zero():
    assert _token_score(0) == 0.0


def test_token_score_sparse():
    score = _token_score(150)
    assert 0.0 < score < 5.0


def test_token_score_ideal():
    assert _token_score(300) == 5.0
    assert _token_score(1000) == 5.0
    assert _token_score(3000) == 5.0


def test_token_score_large():
    score = _token_score(6000)
    assert 1.0 <= score < 5.0


def test_token_score_very_large():
    assert _token_score(100000) == 1.0


@pytest.mark.asyncio
async def test_health_score_cold_start(db: AsyncSession, workspace):
    file = KnowledgeFile(
        workspace_id=workspace.id,
        path="shared/guide.md",
        title="Guide",
        raw_token_count=500,
        resolved_token_count=500,
        linked_paths=[],
    )
    db.add(file)
    await db.commit()
    await db.refresh(file)

    assert await compute_health_score(file.id, db) == 0.0


@pytest.mark.asyncio
async def test_health_score_file_not_found(db: AsyncSession):
    assert await compute_health_score(uuid4(), db) == 0.0


@pytest.mark.asyncio
async def test_health_score_with_runs(db: AsyncSession, workspace, run: Run):
    file_path = "shared/procedure.md"
    file = KnowledgeFile(
        workspace_id=workspace.id,
        path=file_path,
        title="Procedure",
        raw_token_count=800,
        resolved_token_count=800,
        linked_paths=[],
    )
    db.add(file)
    await db.flush()

    node_state = RunNodeState(
        run_id=run.id,
        node_id="n1",
        status="completed",
        output={"text": "result"},
        confidence_score=0.9,
        knowledge_snapshot={file_path: "v1"},
    )
    db.add(node_state)
    await db.commit()
    await db.refresh(file)

    score = await compute_health_score(file.id, db)

    assert 3.0 <= score <= 5.0


@pytest.mark.asyncio
async def test_health_score_cached_on_file(db: AsyncSession, workspace, run: Run):
    file_path = "shared/cached.md"
    file = KnowledgeFile(
        workspace_id=workspace.id,
        path=file_path,
        title="Cached",
        raw_token_count=600,
        resolved_token_count=600,
        linked_paths=[],
    )
    db.add(file)
    await db.flush()

    node_state = RunNodeState(
        run_id=run.id,
        node_id="n1",
        status="completed",
        output={},
        confidence_score=0.8,
        knowledge_snapshot={file_path: "v1"},
    )
    db.add(node_state)
    await db.commit()
    await db.refresh(file)

    score = await compute_health_score(file.id, db)
    await db.refresh(file)

    assert file.health_score is not None
    assert abs(file.health_score - score) < 0.01


@pytest.mark.asyncio
async def test_health_score_with_escalation(db: AsyncSession, workspace, run: Run):
    file_path = "shared/escalated.md"
    file = KnowledgeFile(
        workspace_id=workspace.id,
        path=file_path,
        title="Escalated",
        raw_token_count=600,
        resolved_token_count=600,
        linked_paths=[],
    )
    db.add(file)
    await db.flush()

    node_state = RunNodeState(
        run_id=run.id,
        node_id="n1",
        status="escalated",
        output={},
        confidence_score=0.5,
        knowledge_snapshot={file_path: "v1"},
    )
    db.add(node_state)
    await db.flush()

    escalation = Escalation(
        run_id=run.id,
        run_node_state_id=node_state.id,
        workspace_id=workspace.id,
        type="low_confidence",
        status="open",
        context={},
        assigned_to=[],
    )
    db.add(escalation)
    await db.commit()

    score = await compute_health_score(file.id, db)

    assert score < 4.5


@pytest.mark.asyncio
async def test_health_score_with_rating(db: AsyncSession, workspace, run: Run):
    file_path = "shared/rated.md"
    file = KnowledgeFile(
        workspace_id=workspace.id,
        path=file_path,
        title="Rated",
        raw_token_count=600,
        resolved_token_count=600,
        linked_paths=[],
    )
    db.add(file)
    await db.flush()

    node_state = RunNodeState(
        run_id=run.id,
        node_id="n1",
        status="completed",
        output={},
        confidence_score=0.9,
        knowledge_snapshot={file_path: "v1"},
    )
    db.add(node_state)
    await db.flush()

    await db.commit()

    assert await compute_health_score(file.id, db) >= 3.5

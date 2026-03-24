"""
S9.1 — Workflow Version Management tests.

Coverage:
1. New workflow starts with a bare root draft (version_id=null, parent=null)
2. Draft upsert (create/overwrite)
3. Promote draft → version: gets 9-char version_id, coolname version_name
4. Multiple drafts: one per version, coexist independently
5. Draft run: snapshots definition + draft_snapshot_at; version run: no snapshot
6. Production pointer set atomically on graphs table
7. Archive guard: cannot archive production version
8. Delete guard: cannot delete version with runs or is_public=True
9. Rename version: version_id unchanged
10. Fork version: creates new independent workflow with root draft
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from conftest import SIMPLE_DEFINITION


# ─── 1. New workflow starts with bare root draft ─────────────────────────────

async def test_new_graph_has_root_draft(db, graph):
    """create_graph produces exactly one GraphVersion with version_id=null."""
    from knotwork.graphs.models import GraphVersion
    result = await db.execute(
        select(GraphVersion).where(GraphVersion.graph_id == graph.id)
    )
    versions = result.scalars().all()
    assert len(versions) == 1
    draft = versions[0]
    assert draft.version_id is None
    assert draft.parent_version_id is None


# ─── 2. Draft upsert ─────────────────────────────────────────────────────────

async def test_upsert_root_draft_creates_then_overwrites(db, graph):
    """Upserting the root draft twice results in one record, not two."""
    from knotwork.graphs.version_service import upsert_draft, get_draft_for_version
    from knotwork.graphs.models import GraphVersion

    def_v1 = {**SIMPLE_DEFINITION, "entry_point": "work"}
    def_v2 = {**SIMPLE_DEFINITION, "entry_point": None}

    await upsert_draft(db, graph.id, None, def_v1)
    await upsert_draft(db, graph.id, None, def_v2)

    result = await db.execute(
        select(GraphVersion).where(
            GraphVersion.graph_id == graph.id,
            GraphVersion.version_id.is_(None),
        )
    )
    drafts = result.scalars().all()
    assert len(drafts) == 1
    assert drafts[0].definition["entry_point"] is None


# ─── 3. Promote draft → version ──────────────────────────────────────────────

async def test_promote_root_draft_becomes_version(db, graph):
    """promote_draft_to_version fills version_id (9 chars), version_name (non-null)."""
    from knotwork.graphs.version_service import promote_draft_to_version

    version = await promote_draft_to_version(db, graph.id, None)

    assert version.version_id is not None
    assert len(version.version_id) == 9
    assert version.version_name is not None
    assert version.version_created_at is not None
    # The record now behaves as a version — not a draft
    assert version.version_id.isascii()


async def test_promote_draft_only_explicit(db, graph):
    """Plain create_graph does NOT auto-create a version."""
    from knotwork.graphs.models import GraphVersion
    result = await db.execute(
        select(GraphVersion).where(
            GraphVersion.graph_id == graph.id,
            GraphVersion.version_id.isnot(None),
        )
    )
    assert result.scalars().first() is None


# ─── 4. Multiple drafts coexist ──────────────────────────────────────────────

async def test_multiple_drafts_coexist(db, graph):
    """Each named version can have its own independent draft simultaneously."""
    from knotwork.graphs.version_service import (
        promote_draft_to_version,
        upsert_draft,
        get_draft_for_version,
    )
    from knotwork.graphs.models import GraphVersion

    # Promote root draft → v1
    v1 = await promote_draft_to_version(db, graph.id, None)
    assert v1.version_id is not None

    # Create draft for v1 (root draft was promoted; v1 has no draft yet)
    def_for_v1 = {**SIMPLE_DEFINITION, "nodes": SIMPLE_DEFINITION["nodes"] + [{"id": "extra1", "type": "end", "name": "E1", "config": {}}]}
    await upsert_draft(db, graph.id, v1.id, def_for_v1)

    # Promote that draft → v2
    v2 = await promote_draft_to_version(db, graph.id, v1.id)
    assert v2.version_id is not None
    assert v2.version_id != v1.version_id

    # After promotion, v1 has no draft again. Re-create a new draft for v1.
    def_for_v1_b = {**SIMPLE_DEFINITION, "nodes": SIMPLE_DEFINITION["nodes"] + [{"id": "patch1", "type": "end", "name": "P1", "config": {}}]}
    await upsert_draft(db, graph.id, v1.id, def_for_v1_b)

    # Create a separate draft for v2
    def_for_v2 = {**SIMPLE_DEFINITION, "nodes": SIMPLE_DEFINITION["nodes"] + [{"id": "extra2", "type": "end", "name": "E2", "config": {}}]}
    await upsert_draft(db, graph.id, v2.id, def_for_v2)

    # Both drafts now coexist independently
    fetched_v1_draft = await get_draft_for_version(db, graph.id, v1.id)
    fetched_v2_draft = await get_draft_for_version(db, graph.id, v2.id)
    assert fetched_v1_draft is not None
    assert fetched_v2_draft is not None
    assert fetched_v1_draft.id != fetched_v2_draft.id

    # Each draft's definition is distinct
    assert fetched_v1_draft.definition != fetched_v2_draft.definition

    # Total drafts in DB: exactly two (v1's and v2's drafts; root draft was promoted away)
    result = await db.execute(
        select(GraphVersion).where(
            GraphVersion.graph_id == graph.id,
            GraphVersion.version_id.is_(None),
        )
    )
    all_drafts = result.scalars().all()
    assert len(all_drafts) == 2


# ─── 5. Draft run vs version run ─────────────────────────────────────────────

async def test_draft_run_snapshots_definition(db, graph):
    """Running against a draft populates draft_definition and draft_snapshot_at."""
    from knotwork.graphs.models import GraphVersion
    from knotwork.runs.schemas import RunCreate

    # Get the root draft
    result = await db.execute(
        select(GraphVersion).where(
            GraphVersion.graph_id == graph.id,
            GraphVersion.version_id.is_(None),
        )
    )
    draft = result.scalars().first()
    assert draft is not None

    # Trigger run forcing the draft record
    from knotwork.runs.service import create_run
    run = await create_run(
        db,
        graph.workspace_id,
        graph.id,
        RunCreate(input={}),
        force_graph_version_id=draft.id,
    )

    assert run.draft_definition is not None
    assert run.draft_snapshot_at is not None
    # graph_version_id points to the draft record
    assert run.graph_version_id == draft.id


async def test_version_run_has_no_draft_snapshot(db, graph):
    """Running against a named version produces no draft_definition."""
    from knotwork.graphs.version_service import promote_draft_to_version
    from knotwork.runs.schemas import RunCreate
    from knotwork.runs.service import create_run

    version = await promote_draft_to_version(db, graph.id, None)
    run = await create_run(
        db,
        graph.workspace_id,
        graph.id,
        RunCreate(input={}),
        force_graph_version_id=version.id,
    )

    assert run.draft_definition is None
    assert run.draft_snapshot_at is None
    assert run.graph_version_id == version.id


# ─── 6. Production pointer ────────────────────────────────────────────────────

async def test_set_production_updates_graph(db, graph):
    """set_production writes production_version_id atomically to the graphs row."""
    from knotwork.graphs.version_service import promote_draft_to_version, set_production
    from knotwork.graphs.models import Graph

    version = await promote_draft_to_version(db, graph.id, None)
    updated_graph = await set_production(db, graph.id, version.id)

    assert updated_graph.production_version_id == version.id

    # Confirm in DB
    refreshed = await db.get(Graph, graph.id)
    assert refreshed.production_version_id == version.id


async def test_set_production_rejects_draft(db, graph):
    """set_production raises ValueError when given a draft (no version_id)."""
    from knotwork.graphs.models import GraphVersion
    from knotwork.graphs.version_service import set_production
    from sqlalchemy import select

    result = await db.execute(
        select(GraphVersion).where(
            GraphVersion.graph_id == graph.id,
            GraphVersion.version_id.is_(None),
        )
    )
    draft = result.scalars().first()
    assert draft is not None

    with pytest.raises(ValueError, match="draft"):
        await set_production(db, graph.id, draft.id)


# ─── 7. Archive guard ────────────────────────────────────────────────────────

async def test_cannot_archive_production_version(db, graph):
    from knotwork.graphs.version_service import promote_draft_to_version, set_production, archive_version

    version = await promote_draft_to_version(db, graph.id, None)
    await set_production(db, graph.id, version.id)

    with pytest.raises(ValueError, match="production"):
        await archive_version(db, graph.id, version.id)


async def test_can_archive_non_production_version(db, graph):
    from knotwork.graphs.version_service import promote_draft_to_version, archive_version

    version = await promote_draft_to_version(db, graph.id, None)
    archived = await archive_version(db, graph.id, version.id)

    assert archived.archived_at is not None


# ─── 8. Delete guard ─────────────────────────────────────────────────────────

async def test_cannot_delete_version_with_runs(db, graph):
    from knotwork.graphs.version_service import promote_draft_to_version, delete_version
    from knotwork.runs.schemas import RunCreate
    from knotwork.runs.service import create_run

    version = await promote_draft_to_version(db, graph.id, None)
    await create_run(
        db, graph.workspace_id, graph.id, RunCreate(input={}),
        force_graph_version_id=version.id,
    )

    with pytest.raises(ValueError, match="runs"):
        await delete_version(db, graph.id, version.id)


async def test_cannot_delete_version_with_public_page(db, graph):
    from knotwork.graphs.version_service import promote_draft_to_version, delete_version
    from knotwork.graphs.models import GraphVersion

    version = await promote_draft_to_version(db, graph.id, None)
    # Manually enable public page
    version.is_public = True
    await db.commit()

    with pytest.raises(ValueError, match="public"):
        await delete_version(db, graph.id, version.id)


async def test_can_delete_version_without_runs_or_public(db, graph):
    from knotwork.graphs.version_service import promote_draft_to_version, delete_version
    from knotwork.graphs.models import GraphVersion
    from sqlalchemy import select

    version = await promote_draft_to_version(db, graph.id, None)
    version_id = version.id
    await delete_version(db, graph.id, version.id)

    result = await db.execute(
        select(GraphVersion).where(GraphVersion.id == version_id)
    )
    assert result.scalar_one_or_none() is None


# ─── 9. Rename version ───────────────────────────────────────────────────────

async def test_rename_version_preserves_version_id(db, graph):
    from knotwork.graphs.version_service import promote_draft_to_version, rename_version

    version = await promote_draft_to_version(db, graph.id, None)
    original_vid = version.version_id

    renamed = await rename_version(db, graph.id, version.id, "my-custom-name")

    assert renamed.version_name == "my-custom-name"
    assert renamed.version_id == original_vid


# ─── 10. Fork version ────────────────────────────────────────────────────────

async def test_fork_version_creates_new_workflow(db, graph, workspace):
    from knotwork.graphs.version_service import promote_draft_to_version, fork_version
    from knotwork.graphs.models import GraphVersion
    from sqlalchemy import select

    version = await promote_draft_to_version(db, graph.id, None)
    new_graph = await fork_version(db, workspace.id, graph.id, version.id, "Forked Workflow")

    assert new_graph.id != graph.id
    assert new_graph.name == "Forked Workflow"

    # New graph has its own root draft
    result = await db.execute(
        select(GraphVersion).where(
            GraphVersion.graph_id == new_graph.id,
            GraphVersion.version_id.is_(None),
            GraphVersion.parent_version_id.is_(None),
        )
    )
    new_draft = result.scalar_one_or_none()
    assert new_draft is not None
    # Draft definition matches the forked version
    assert new_draft.definition == version.definition


async def test_cannot_fork_a_draft(db, graph, workspace):
    from knotwork.graphs.version_service import fork_version
    from knotwork.graphs.models import GraphVersion
    from sqlalchemy import select

    result = await db.execute(
        select(GraphVersion).where(
            GraphVersion.graph_id == graph.id,
            GraphVersion.version_id.is_(None),
        )
    )
    draft = result.scalars().first()

    with pytest.raises(ValueError, match="draft"):
        await fork_version(db, workspace.id, graph.id, draft.id, "Forked")


# ─── namegen utility ─────────────────────────────────────────────────────────

def test_generate_name_format():
    """generate_name returns adjective-noun-number slug."""
    from knotwork.utils.namegen import generate_name
    name = generate_name()
    parts = name.split("-")
    assert len(parts) >= 3
    # Last part is a number
    assert parts[-1].isdigit()

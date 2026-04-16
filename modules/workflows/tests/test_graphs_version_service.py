from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from libs.namegen import generate_name
from modules.workflows.backend.graphs.models import Graph, GraphVersion
from modules.workflows.backend.graphs.version_service import (
    archive_version,
    delete_version,
    fork_version,
    get_draft_for_version,
    promote_draft_to_version,
    rename_version,
    set_production,
    upsert_draft,
)
from modules.workflows.backend.runs.schemas import RunCreate
from modules.workflows.backend.runs.service import create_run

SIMPLE_DEFINITION = {
    "name": "Workflow",
    "nodes": [
        {"id": "start", "type": "start", "name": "Start", "config": {}},
        {
            "id": "work",
            "type": "agent",
            "name": "Work",
            "agent_ref": "human",
            "operator_id": "human:operator",
            "supervisor_id": "human:supervisor",
            "config": {},
        },
        {"id": "end", "type": "end", "name": "End", "config": {}},
    ],
    "edges": [
        {"id": "e1", "source": "start", "target": "work", "type": "direct"},
        {"id": "e2", "source": "work", "target": "end", "type": "direct"},
    ],
    "entry_point": "work",
}


@pytest.fixture(autouse=True)
def stub_channel_side_effects(monkeypatch):
    async def _noop(*args, **kwargs):
        return None

    async def _run_channel(*args, **kwargs):
        return SimpleNamespace(id="run-channel")

    async def _bound_channel_ids(*args, **kwargs):
        return []

    monkeypatch.setattr("modules.workflows.backend.graphs.version_service.core_channels.emit_asset_activity_message", _noop)
    monkeypatch.setattr("modules.workflows.backend.runs.service.core_channels.get_or_create_run_channel", _run_channel)
    monkeypatch.setattr("modules.workflows.backend.runs.service.core_channels.create_message", _noop)
    monkeypatch.setattr(
        "modules.workflows.backend.runs.service.core_channels.list_bound_channel_ids_for_asset",
        _bound_channel_ids,
    )


@pytest.mark.asyncio
async def test_new_graph_has_root_draft(db: AsyncSession, graph: Graph):
    result = await db.execute(select(GraphVersion).where(GraphVersion.graph_id == graph.id))
    versions = result.scalars().all()

    assert len(versions) == 1
    assert versions[0].version_id is None
    assert versions[0].parent_version_id is None


@pytest.mark.asyncio
async def test_upsert_root_draft_creates_then_overwrites(db: AsyncSession, graph: Graph):
    definition_v1 = {**SIMPLE_DEFINITION, "entry_point": "work"}
    definition_v2 = {**SIMPLE_DEFINITION, "entry_point": None}

    await upsert_draft(db, graph.id, None, definition_v1)
    await upsert_draft(db, graph.id, None, definition_v2)

    result = await db.execute(
        select(GraphVersion).where(GraphVersion.graph_id == graph.id, GraphVersion.version_id.is_(None))
    )
    drafts = result.scalars().all()

    assert len(drafts) == 1
    assert drafts[0].definition["entry_point"] is None


@pytest.mark.asyncio
async def test_promote_root_draft_becomes_version(db: AsyncSession, graph: Graph):
    version = await promote_draft_to_version(db, graph.id, None)

    assert version.version_id is not None
    assert len(version.version_id) == 9
    assert version.version_name is not None
    assert version.version_created_at is not None
    assert version.version_id.isascii()


@pytest.mark.asyncio
async def test_promote_draft_only_explicit(db: AsyncSession, graph: Graph):
    result = await db.execute(
        select(GraphVersion).where(GraphVersion.graph_id == graph.id, GraphVersion.version_id.isnot(None))
    )
    assert result.scalars().first() is None


@pytest.mark.asyncio
async def test_multiple_drafts_coexist(db: AsyncSession, graph: Graph):
    v1 = await promote_draft_to_version(db, graph.id, None)
    await upsert_draft(db, graph.id, v1.id, {**SIMPLE_DEFINITION, "nodes": SIMPLE_DEFINITION["nodes"] + [{"id": "extra1", "type": "end", "name": "E1", "config": {}}]})
    v2 = await promote_draft_to_version(db, graph.id, v1.id)
    await upsert_draft(db, graph.id, v1.id, {**SIMPLE_DEFINITION, "nodes": SIMPLE_DEFINITION["nodes"] + [{"id": "patch1", "type": "end", "name": "P1", "config": {}}]})
    await upsert_draft(db, graph.id, v2.id, {**SIMPLE_DEFINITION, "nodes": SIMPLE_DEFINITION["nodes"] + [{"id": "extra2", "type": "end", "name": "E2", "config": {}}]})

    v1_draft = await get_draft_for_version(db, graph.id, v1.id)
    v2_draft = await get_draft_for_version(db, graph.id, v2.id)
    result = await db.execute(
        select(GraphVersion).where(GraphVersion.graph_id == graph.id, GraphVersion.version_id.is_(None))
    )

    assert v1_draft is not None
    assert v2_draft is not None
    assert v1_draft.id != v2_draft.id
    assert v1_draft.definition != v2_draft.definition
    assert len(result.scalars().all()) == 2


@pytest.mark.asyncio
async def test_draft_run_snapshots_definition(db: AsyncSession, graph: Graph):
    draft = await get_draft_for_version(db, graph.id, None)

    run = await create_run(
        db,
        graph.workspace_id,
        graph.id,
        RunCreate(input={}),
        force_graph_version_id=draft.id,
    )

    assert run.draft_definition is not None
    assert run.draft_snapshot_at is not None
    assert run.graph_version_id == draft.id


@pytest.mark.asyncio
async def test_version_run_has_no_draft_snapshot(db: AsyncSession, graph: Graph):
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


@pytest.mark.asyncio
async def test_set_production_updates_graph(db: AsyncSession, graph: Graph):
    version = await promote_draft_to_version(db, graph.id, None)
    updated = await set_production(db, graph.id, version.id)

    assert updated.production_version_id == version.id
    assert (await db.get(Graph, graph.id)).production_version_id == version.id


@pytest.mark.asyncio
async def test_set_production_rejects_draft(db: AsyncSession, graph: Graph):
    draft = await get_draft_for_version(db, graph.id, None)

    with pytest.raises(ValueError, match="draft"):
        await set_production(db, graph.id, draft.id)


@pytest.mark.asyncio
async def test_cannot_archive_production_version(db: AsyncSession, graph: Graph):
    version = await promote_draft_to_version(db, graph.id, None)
    await set_production(db, graph.id, version.id)

    with pytest.raises(ValueError, match="production"):
        await archive_version(db, graph.id, version.id)


@pytest.mark.asyncio
async def test_can_archive_non_production_version(db: AsyncSession, graph: Graph):
    version = await promote_draft_to_version(db, graph.id, None)
    archived = await archive_version(db, graph.id, version.id)

    assert archived.archived_at is not None


@pytest.mark.asyncio
async def test_cannot_delete_version_with_runs(db: AsyncSession, graph: Graph):
    version = await promote_draft_to_version(db, graph.id, None)
    await create_run(db, graph.workspace_id, graph.id, RunCreate(input={}), force_graph_version_id=version.id)

    with pytest.raises(ValueError, match="runs"):
        await delete_version(db, graph.id, version.id)


@pytest.mark.asyncio
async def test_cannot_delete_version_with_public_page(db: AsyncSession, graph: Graph):
    version = await promote_draft_to_version(db, graph.id, None)
    version.version_slug = "test-slug-42"
    await db.commit()

    with pytest.raises(ValueError, match="public"):
        await delete_version(db, graph.id, version.id)


@pytest.mark.asyncio
async def test_can_delete_version_without_runs_or_public(db: AsyncSession, graph: Graph):
    version = await promote_draft_to_version(db, graph.id, None)
    version_id = version.id

    await delete_version(db, graph.id, version.id)

    result = await db.execute(select(GraphVersion).where(GraphVersion.id == version_id))
    assert result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_rename_version_preserves_version_id(db: AsyncSession, graph: Graph):
    version = await promote_draft_to_version(db, graph.id, None)
    original_version_id = version.version_id

    renamed = await rename_version(db, graph.id, version.id, "my-custom-name")

    assert renamed.version_name == "my-custom-name"
    assert renamed.version_id == original_version_id


@pytest.mark.asyncio
async def test_fork_version_creates_new_workflow(db: AsyncSession, graph: Graph, workspace):
    version = await promote_draft_to_version(db, graph.id, None)
    new_graph = await fork_version(db, workspace.id, graph.id, version.id, "Forked Workflow")
    result = await db.execute(
        select(GraphVersion).where(
            GraphVersion.graph_id == new_graph.id,
            GraphVersion.version_id.is_(None),
            GraphVersion.parent_version_id.is_(None),
        )
    )
    new_draft = result.scalar_one_or_none()

    assert new_graph.id != graph.id
    assert new_graph.name == "Forked Workflow"
    assert new_draft is not None
    assert new_draft.definition == version.definition


@pytest.mark.asyncio
async def test_cannot_fork_a_draft(db: AsyncSession, graph: Graph, workspace):
    draft = await get_draft_for_version(db, graph.id, None)

    with pytest.raises(ValueError, match="draft"):
        await fork_version(db, workspace.id, graph.id, draft.id, "Forked")


def test_generate_name_format():
    name = generate_name()
    parts = name.split("-")

    assert len(parts) >= 3
    assert parts[-1].isdigit()

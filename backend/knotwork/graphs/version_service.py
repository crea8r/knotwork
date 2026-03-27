"""Version management service for S9.1.

Handles: draft upsert, promote-to-version, production pointer,
archive, delete-guard, fork, rename, version listing.
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.graphs.models import Graph, GraphVersion
from knotwork.runs.models import Run
from knotwork.utils.namegen import generate_name


def _make_version_id() -> str:
    """9-char random alphanumeric ID for a version."""
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(9))


async def get_draft_for_version(
    db: AsyncSession, graph_id: UUID, parent_version_id: UUID | None
) -> GraphVersion | None:
    """Return the single draft whose parent is `parent_version_id` (None = root draft)."""
    q = select(GraphVersion).where(
        GraphVersion.graph_id == graph_id,
        GraphVersion.version_id.is_(None),
    )
    if parent_version_id is None:
        q = q.where(GraphVersion.parent_version_id.is_(None))
    else:
        q = q.where(GraphVersion.parent_version_id == parent_version_id)
    result = await db.execute(q)
    return result.scalar_one_or_none()


async def upsert_draft(
    db: AsyncSession,
    graph_id: UUID,
    parent_version_id: UUID | None,
    definition: dict,
    created_by: UUID | None = None,
) -> GraphVersion:
    """Create or overwrite the draft for a given parent version."""
    draft = await get_draft_for_version(db, graph_id, parent_version_id)
    if draft is None:
        draft = GraphVersion(
            graph_id=graph_id,
            definition=definition,
            parent_version_id=parent_version_id,
            created_by=created_by,
        )
        db.add(draft)
    else:
        draft.definition = definition
        draft.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(draft)
    graph = await db.get(Graph, graph_id)
    from knotwork.channels import service as channel_service

    await channel_service.emit_asset_activity_message(
        db,
        workspace_id=graph.workspace_id,
        asset_type="workflow",
        asset_id=str(graph_id),
        content="Workflow draft updated",
        metadata={"workflow_event": "draft_updated", "graph_id": str(graph_id), "draft_row_id": str(draft.id)},
    )
    return draft


async def promote_draft_to_version(
    db: AsyncSession, graph_id: UUID, parent_version_id: UUID | None
) -> GraphVersion:
    """Mutate the draft in place: fill version_id, version_name, version_created_at."""
    # Guard: at most one root version per graph
    if parent_version_id is None:
        result = await db.execute(
            select(GraphVersion).where(
                GraphVersion.graph_id == graph_id,
                GraphVersion.version_id.isnot(None),
                GraphVersion.parent_version_id.is_(None),
            )
        )
        if result.scalar_one_or_none() is not None:
            raise ValueError(
                "A root version already exists for this graph. "
                "Edit the existing version to create a child version instead."
            )

    draft = await get_draft_for_version(db, graph_id, parent_version_id)
    if draft is None:
        raise ValueError("No draft found for this version")

    now = datetime.now(timezone.utc)
    draft.version_id = _make_version_id()
    draft.version_name = generate_name()
    draft.version_created_at = now
    # Freeze updated_at so run history can refer to last-edit time
    draft.updated_at = now
    await db.commit()
    await db.refresh(draft)
    graph = await db.get(Graph, graph_id)
    from knotwork.channels import service as channel_service

    await channel_service.emit_asset_activity_message(
        db,
        workspace_id=graph.workspace_id,
        asset_type="workflow",
        asset_id=str(graph_id),
        content=f"Workflow version published: {draft.version_name or draft.version_id}",
        metadata={"workflow_event": "version_published", "graph_id": str(graph_id), "version_row_id": str(draft.id)},
    )
    return draft


async def list_versions(
    db: AsyncSession,
    graph_id: UUID,
    include_archived: bool = False,
) -> list[GraphVersion]:
    """Return all named versions for a graph, ordered by version_created_at desc."""
    q = select(GraphVersion).where(
        GraphVersion.graph_id == graph_id,
        GraphVersion.version_id.isnot(None),
    )
    if not include_archived:
        q = q.where(GraphVersion.archived_at.is_(None))
    q = q.order_by(GraphVersion.version_created_at.desc())
    result = await db.execute(q)
    return list(result.scalars())


async def get_version_run_count(db: AsyncSession, version_id: UUID) -> int:
    result = await db.execute(
        select(func.count(Run.id)).where(Run.graph_version_id == version_id)
    )
    return int(result.scalar_one() or 0)


async def set_production(
    db: AsyncSession, graph_id: UUID, graph_version_row_id: UUID
) -> Graph:
    """Set the production version pointer on the graph."""
    graph = await db.get(Graph, graph_id)
    if graph is None:
        raise ValueError("Graph not found")
    version = await db.get(GraphVersion, graph_version_row_id)
    if version is None or version.graph_id != graph_id or version.version_id is None:
        raise ValueError("Version not found or is a draft")
    graph.production_version_id = graph_version_row_id
    await db.commit()
    await db.refresh(graph)
    from knotwork.channels import service as channel_service

    await channel_service.emit_asset_activity_message(
        db,
        workspace_id=graph.workspace_id,
        asset_type="workflow",
        asset_id=str(graph_id),
        content=f"Workflow production version changed to {version.version_name or version.version_id}",
        metadata={"workflow_event": "production_changed", "graph_id": str(graph_id), "version_row_id": str(version.id)},
    )
    return graph


async def archive_version(db: AsyncSession, graph_id: UUID, version_row_id: UUID) -> GraphVersion:
    """Archive a version. Blocks if it is the current production version."""
    graph = await db.get(Graph, graph_id)
    version = await db.get(GraphVersion, version_row_id)
    if version is None or version.graph_id != graph_id:
        raise ValueError("Version not found")
    if graph and graph.production_version_id == version_row_id:
        raise ValueError("Cannot archive the production version")
    version.archived_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(version)
    from knotwork.channels import service as channel_service

    await channel_service.emit_asset_activity_message(
        db,
        workspace_id=graph.workspace_id,
        asset_type="workflow",
        asset_id=str(graph_id),
        content=f"Workflow version archived: {version.version_name or version.version_id}",
        metadata={"workflow_event": "version_archived", "graph_id": str(graph_id), "version_row_id": str(version.id)},
    )
    return version


async def unarchive_version(db: AsyncSession, graph_id: UUID, version_row_id: UUID) -> GraphVersion:
    version = await db.get(GraphVersion, version_row_id)
    if version is None or version.graph_id != graph_id:
        raise ValueError("Version not found")
    version.archived_at = None
    await db.commit()
    await db.refresh(version)
    graph = await db.get(Graph, graph_id)
    from knotwork.channels import service as channel_service

    await channel_service.emit_asset_activity_message(
        db,
        workspace_id=graph.workspace_id,
        asset_type="workflow",
        asset_id=str(graph_id),
        content=f"Workflow version unarchived: {version.version_name or version.version_id}",
        metadata={"workflow_event": "version_unarchived", "graph_id": str(graph_id), "version_row_id": str(version.id)},
    )
    return version


async def delete_version(db: AsyncSession, graph_id: UUID, version_row_id: UUID) -> None:
    """Delete a version. Blocked if it has runs or is_public."""
    version = await db.get(GraphVersion, version_row_id)
    if version is None or version.graph_id != graph_id:
        raise ValueError("Version not found")
    if version.is_public:
        raise ValueError("Cannot delete a version with an active public page")
    run_count = await get_version_run_count(db, version_row_id)
    if run_count > 0:
        raise ValueError("Cannot delete a version that has runs")

    # Also delete its draft if one exists
    draft = await get_draft_for_version(db, graph_id, version_row_id)
    if draft is not None:
        await db.delete(draft)
    await db.delete(version)
    await db.commit()


async def rename_version(
    db: AsyncSession, graph_id: UUID, version_row_id: UUID, new_name: str
) -> GraphVersion:
    version = await db.get(GraphVersion, version_row_id)
    if version is None or version.graph_id != graph_id or version.version_id is None:
        raise ValueError("Version not found")
    version.version_name = new_name
    await db.commit()
    await db.refresh(version)
    graph = await db.get(Graph, graph_id)
    from knotwork.channels import service as channel_service

    await channel_service.emit_asset_activity_message(
        db,
        workspace_id=graph.workspace_id,
        asset_type="workflow",
        asset_id=str(graph_id),
        content=f"Workflow version renamed to {new_name}",
        metadata={"workflow_event": "version_renamed", "graph_id": str(graph_id), "version_row_id": str(version.id)},
    )
    return version


async def fork_version(
    db: AsyncSession,
    workspace_id: UUID,
    source_graph_id: UUID,
    version_row_id: UUID,
    new_workflow_name: str,
    created_by: UUID | None = None,
) -> Graph:
    """Fork a version into a brand new independent workflow."""
    source_version = await db.get(GraphVersion, version_row_id)
    source_graph = await db.get(Graph, source_graph_id)
    if source_version is None or source_version.graph_id != source_graph_id:
        raise ValueError("Version not found")
    if source_version.version_id is None:
        raise ValueError("Cannot fork a draft — promote it to a version first")

    new_graph = Graph(
        workspace_id=workspace_id,
        name=new_workflow_name,
        path=source_graph.path if source_graph else "",
        created_by=created_by,
    )
    db.add(new_graph)
    await db.flush()

    # New workflow starts with a root draft copied from the forked version
    new_draft = GraphVersion(
        graph_id=new_graph.id,
        definition=source_version.definition,
        created_by=created_by,
    )
    db.add(new_draft)
    await db.commit()
    await db.refresh(new_graph)
    return new_graph

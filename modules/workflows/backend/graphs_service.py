from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import channels as core_channels
from .tools_models import Tool, ToolVersion
from sqlalchemy import delete as sql_delete

from .graphs_models import Graph, GraphVersion
from .graphs_schemas import GraphCreate, GraphUpdate, GraphVersionCreate
from .runs_models import Run
from modules.communication.backend.channels_models import Channel


async def list_graphs(db: AsyncSession, workspace_id: UUID, project_id: UUID | None = None) -> list[Graph]:
    stmt = select(Graph).where(Graph.workspace_id == workspace_id)
    if project_id is None:
        stmt = stmt.where(Graph.project_id.is_(None))
    else:
        stmt = stmt.where(Graph.project_id == project_id)
    result = await db.execute(stmt.order_by(Graph.created_at.desc()))
    return list(result.scalars())


async def get_graph(db: AsyncSession, graph_id: UUID) -> Graph | None:
    return await db.get(Graph, graph_id)


async def get_latest_version(db: AsyncSession, graph_id: UUID) -> GraphVersion | None:
    """Return the most recently created named version (not draft)."""
    result = await db.execute(
        select(GraphVersion)
        .where(GraphVersion.graph_id == graph_id, GraphVersion.version_id.isnot(None))
        .order_by(GraphVersion.version_created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_root_draft(db: AsyncSession, graph_id: UUID) -> GraphVersion | None:
    """Return the root draft (parent_version_id IS NULL) for a graph."""
    result = await db.execute(
        select(GraphVersion)
        .where(
            GraphVersion.graph_id == graph_id,
            GraphVersion.version_id.is_(None),
            GraphVersion.parent_version_id.is_(None),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_any_draft(db: AsyncSession, graph_id: UUID) -> GraphVersion | None:
    """Return any draft for a graph (newest by updated_at). Used by designer."""
    result = await db.execute(
        select(GraphVersion)
        .where(GraphVersion.graph_id == graph_id, GraphVersion.version_id.is_(None))
        .order_by(GraphVersion.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def create_graph(
    db: AsyncSession,
    workspace_id: UUID,
    data: GraphCreate,
    created_by: UUID | None = None,
) -> Graph:
    graph = Graph(
        workspace_id=workspace_id,
        project_id=data.project_id,
        name=data.name,
        path=data.path,
        description=data.description,
        default_model=data.default_model,
        created_by=created_by,
    )
    db.add(graph)
    await db.flush()

    # S9.1: new workflows start with a bare draft (no parent version, no version_id)
    draft = GraphVersion(
        graph_id=graph.id,
        definition=data.definition.model_dump(),
        created_by=created_by,
    )
    db.add(draft)
    db.add(
        Channel(
            workspace_id=workspace_id,
            name=f"wf: {graph.name}",
            slug=await core_channels.generate_channel_slug(db, graph.name),
            channel_type="workflow",
            graph_id=graph.id,
            project_id=data.project_id,
        )
    )
    await db.commit()
    await db.refresh(graph)
    await core_channels.ensure_default_channel_subscriptions(db, workspace_id)
    return graph


async def update_graph(
    db: AsyncSession, graph_id: UUID, data: GraphUpdate
) -> Graph | None:
    graph = await db.get(Graph, graph_id)
    if graph is None:
        return None
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(graph, field, value)
    workflow_channel = (
        await db.execute(
            select(Channel).where(
                Channel.workspace_id == graph.workspace_id,
                Channel.graph_id == graph_id,
                Channel.channel_type == "workflow",
            ).limit(1)
        )
    ).scalar_one_or_none()
    if workflow_channel is not None:
        workflow_channel.name = f"wf: {graph.name}"
        workflow_channel.project_id = graph.project_id
    await db.commit()
    await db.refresh(graph)
    return graph


async def delete_graph(db: AsyncSession, graph_id: UUID) -> bool:
    graph = await db.get(Graph, graph_id)
    if graph is None:
        return False
    await db.execute(sql_delete(GraphVersion).where(GraphVersion.graph_id == graph_id))
    await db.delete(graph)
    await db.commit()
    return True


async def count_graph_runs(db: AsyncSession, workspace_id: UUID, graph_id: UUID) -> int:
    result = await db.execute(
        select(func.count(Run.id)).where(
            Run.workspace_id == workspace_id,
            Run.graph_id == graph_id,
        )
    )
    return int(result.scalar_one() or 0)


async def list_graph_run_counts(db: AsyncSession, workspace_id: UUID) -> dict[UUID, int]:
    result = await db.execute(
        select(Run.graph_id, func.count(Run.id))
        .where(Run.workspace_id == workspace_id)
        .group_by(Run.graph_id)
    )
    return {row[0]: int(row[1]) for row in result.all()}


async def retire_graph(db: AsyncSession, workspace_id: UUID, graph_id: UUID) -> tuple[str, int] | None:
    """
    Lifecycle rule:
    - No runs yet => hard delete workflow.
    - Has runs => archive workflow.
    """
    graph = await db.get(Graph, graph_id)
    if graph is None or graph.workspace_id != workspace_id:
        return None

    run_count = await count_graph_runs(db, workspace_id, graph_id)
    if run_count > 0:
        if graph.status != "archived":
            graph.status = "archived"
            await db.commit()
        return ("archived", run_count)

    # Hard-delete cleanup for graph-scoped records that hold FK to graphs.id.
    # Channel messages are cascade-deleted via channels.id FK.
    await db.execute(
        sql_delete(Channel).where(
            Channel.workspace_id == workspace_id,
            Channel.graph_id == graph_id,
        )
    )

    tool_ids_result = await db.execute(select(Tool.id).where(Tool.graph_id == graph_id))
    tool_ids = [row[0] for row in tool_ids_result.all()]
    if tool_ids:
        await db.execute(sql_delete(ToolVersion).where(ToolVersion.tool_id.in_(tool_ids)))
    await db.execute(sql_delete(Tool).where(Tool.graph_id == graph_id))

    await db.execute(sql_delete(GraphVersion).where(GraphVersion.graph_id == graph_id))
    await db.delete(graph)
    await db.commit()
    return ("deleted", 0)


async def save_version(
    db: AsyncSession,
    graph_id: UUID,
    data: GraphVersionCreate,
    created_by: UUID | None = None,
) -> GraphVersion:
    """Legacy: create a new named version directly (used by older tests)."""
    from libs.namegen import generate_name
    from .graphs_version_service import _make_version_id
    from datetime import datetime, timezone

    version = GraphVersion(
        graph_id=graph_id,
        definition=data.definition.model_dump(),
        note=data.note,
        version_id=_make_version_id(),
        version_name=generate_name(),
        version_created_at=datetime.now(timezone.utc),
        created_by=created_by,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    graph = await db.get(Graph, graph_id)

    await core_channels.emit_asset_activity_message(
        db,
        workspace_id=graph.workspace_id,
        asset_type="workflow",
        asset_id=str(graph_id),
        content=f"Workflow version saved: {version.version_name or version.version_id}",
        metadata={"workflow_event": "version_saved", "graph_id": str(graph_id), "version_row_id": str(version.id)},
    )
    return version

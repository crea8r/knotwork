from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels.models import Channel
from knotwork.graphs.models import Graph, GraphVersion
from knotwork.runs.models import Run
from knotwork.tools.models import Tool, ToolVersion
from sqlalchemy import delete as sql_delete
from knotwork.graphs.schemas import GraphCreate, GraphUpdate, GraphVersionCreate


async def list_graphs(db: AsyncSession, workspace_id: UUID) -> list[Graph]:
    result = await db.execute(
        select(Graph)
        .where(Graph.workspace_id == workspace_id)
        .order_by(Graph.created_at.desc())
    )
    return list(result.scalars())


async def get_graph(db: AsyncSession, graph_id: UUID) -> Graph | None:
    return await db.get(Graph, graph_id)


async def get_latest_version(db: AsyncSession, graph_id: UUID) -> GraphVersion | None:
    result = await db.execute(
        select(GraphVersion)
        .where(GraphVersion.graph_id == graph_id)
        .order_by(GraphVersion.created_at.desc())
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
        name=data.name,
        description=data.description,
        default_model=data.default_model,
        created_by=created_by,
    )
    db.add(graph)
    await db.flush()

    version = GraphVersion(
        graph_id=graph.id,
        definition=data.definition.model_dump(),
        created_by=created_by,
    )
    db.add(version)
    await db.commit()
    await db.refresh(graph)
    return graph


async def update_graph(
    db: AsyncSession, graph_id: UUID, data: GraphUpdate
) -> Graph | None:
    graph = await db.get(Graph, graph_id)
    if graph is None:
        return None
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(graph, field, value)
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
    version = GraphVersion(
        graph_id=graph_id,
        definition=data.definition.model_dump(),
        note=data.note,
        created_by=created_by,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return version

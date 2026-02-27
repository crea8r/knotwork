from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.graphs.models import Graph, GraphVersion
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

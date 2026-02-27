from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.graphs import service
from knotwork.graphs.schemas import (
    GraphCreate,
    GraphOut,
    GraphVersionCreate,
    GraphVersionOut,
)

router = APIRouter(prefix="/workspaces", tags=["graphs"])


async def _graph_out(db: AsyncSession, graph) -> GraphOut:
    ver = await service.get_latest_version(db, graph.id)
    out = GraphOut.model_validate(graph)
    out.latest_version = GraphVersionOut.model_validate(ver) if ver else None
    return out


@router.get("/{workspace_id}/graphs", response_model=list[GraphOut])
async def list_graphs(workspace_id: UUID, db: AsyncSession = Depends(get_db)):
    graphs = await service.list_graphs(db, workspace_id)
    return [await _graph_out(db, g) for g in graphs]


@router.post("/{workspace_id}/graphs", response_model=GraphOut, status_code=201)
async def create_graph(
    workspace_id: UUID, data: GraphCreate, db: AsyncSession = Depends(get_db)
):
    graph = await service.create_graph(db, workspace_id, data)
    return await _graph_out(db, graph)


@router.get("/{workspace_id}/graphs/{graph_id}", response_model=GraphOut)
async def get_graph(
    workspace_id: UUID, graph_id: UUID, db: AsyncSession = Depends(get_db)
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    return await _graph_out(db, graph)


@router.post("/{workspace_id}/graphs/{graph_id}/versions", response_model=GraphVersionOut, status_code=201)
async def save_version(
    workspace_id: UUID,
    graph_id: UUID,
    data: GraphVersionCreate,
    db: AsyncSession = Depends(get_db),
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    version = await service.save_version(db, graph_id, data)
    return GraphVersionOut.model_validate(version)


@router.patch("/{workspace_id}/graphs/{graph_id}")
async def update_graph(workspace_id: str, graph_id: str):
    return {"message": "not implemented"}


@router.delete("/{workspace_id}/graphs/{graph_id}")
async def delete_graph(workspace_id: str, graph_id: str):
    return {"message": "not implemented"}


@router.post("/{workspace_id}/graphs/import-md")
async def import_graph_from_md(workspace_id: str):
    return {"message": "not implemented"}


@router.post("/{workspace_id}/graphs/design/chat")
async def design_chat(workspace_id: str):
    return {"message": "not implemented"}

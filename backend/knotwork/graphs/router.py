from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.graphs import service
from knotwork.graphs.schemas import (
    DesignChatRequest,
    DesignChatResponse,
    GraphCreate,
    GraphOut,
    GraphUpdate,
    GraphVersionCreate,
    GraphVersionOut,
    ImportMdRequest,
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


@router.patch("/{workspace_id}/graphs/{graph_id}", response_model=GraphOut)
async def update_graph(
    workspace_id: UUID,
    graph_id: UUID,
    data: GraphUpdate,
    db: AsyncSession = Depends(get_db),
):
    graph = await service.update_graph(db, graph_id, data)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    return await _graph_out(db, graph)


@router.delete("/{workspace_id}/graphs/{graph_id}", status_code=204)
async def delete_graph(
    workspace_id: UUID, graph_id: UUID, db: AsyncSession = Depends(get_db)
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    await service.delete_graph(db, graph_id)


@router.post("/{workspace_id}/graphs/import-md", response_model=GraphOut, status_code=201)
async def import_graph_from_md(
    workspace_id: UUID, body: ImportMdRequest, db: AsyncSession = Depends(get_db)
):
    from knotwork.designer.parser import parse_md_to_graph
    from knotwork.graphs.schemas import GraphDefinitionSchema
    draft = parse_md_to_graph(body.content, body.name)
    data = GraphCreate(
        name=draft["name"],
        definition=GraphDefinitionSchema.model_validate({
            "nodes": draft["nodes"],
            "edges": draft["edges"],
            "entry_point": draft.get("entry_point"),
        }),
    )
    graph = await service.create_graph(db, workspace_id, data)
    return await _graph_out(db, graph)


@router.get("/{workspace_id}/graphs/versions/{version_id}", response_model=GraphVersionOut)
async def get_graph_version(
    workspace_id: UUID, version_id: UUID, db: AsyncSession = Depends(get_db)
):
    """Return a specific graph version by ID (used to show exact config of a run)."""
    from knotwork.graphs.models import GraphVersion
    version = await db.get(GraphVersion, version_id)
    if not version:
        raise HTTPException(404, "Version not found")
    # Verify workspace ownership via graph
    graph = await service.get_graph(db, version.graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Version not found")
    return GraphVersionOut.model_validate(version)


@router.post("/{workspace_id}/graphs/design/chat", response_model=DesignChatResponse)
async def design_chat(
    workspace_id: UUID, body: DesignChatRequest, db: AsyncSession = Depends(get_db)
):
    from knotwork.designer.agent import design_graph
    graph = await service.get_graph(db, UUID(body.graph_id))
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    version = await service.get_latest_version(db, graph.id)
    existing = version.definition if version else None
    result = await design_graph(
        session_id=body.session_id,
        message=body.message,
        workspace_id=str(workspace_id),
        existing_graph=existing,
        db=db,
        graph_id=str(graph.id),
    )
    return DesignChatResponse(**result)


@router.get("/{workspace_id}/graphs/{graph_id}/designer-messages")
async def list_designer_messages(
    workspace_id: UUID, graph_id: UUID, db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import select
    from knotwork.designer.models import DesignerChatMessage
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    result = await db.execute(
        select(DesignerChatMessage)
        .where(DesignerChatMessage.graph_id == graph_id)
        .order_by(DesignerChatMessage.created_at.asc())
    )
    msgs = result.scalars().all()
    return [
        {"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
        for m in msgs
    ]


@router.delete("/{workspace_id}/graphs/{graph_id}/designer-messages", status_code=204)
async def clear_designer_messages(
    workspace_id: UUID, graph_id: UUID, db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import delete
    from knotwork.designer.models import DesignerChatMessage
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    await db.execute(
        delete(DesignerChatMessage).where(DesignerChatMessage.graph_id == graph_id)
    )
    await db.commit()

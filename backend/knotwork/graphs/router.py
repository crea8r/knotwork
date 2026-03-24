from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.graphs import service, version_service
from knotwork.graphs.schemas import (
    DesignChatRequest,
    DesignChatResponse,
    DraftUpsertRequest,
    ForkRequest,
    GraphCreate,
    GraphDeleteResult,
    GraphOut,
    GraphUpdate,
    GraphVersionCreate,
    GraphVersionOut,
    ImportMdRequest,
    VersionRenameRequest,
)

router = APIRouter(prefix="/workspaces", tags=["graphs"])


async def _graph_out(db: AsyncSession, graph, run_count: int | None = None) -> GraphOut:
    # Prefer the latest named version; fall back to root draft for new graphs
    ver = await service.get_latest_version(db, graph.id) or await service.get_root_draft(db, graph.id)
    out = GraphOut.model_validate(graph)
    out.run_count = run_count if run_count is not None else await service.count_graph_runs(db, graph.workspace_id, graph.id)
    out.latest_version = GraphVersionOut.model_validate(ver) if ver else None
    return out


@router.get("/{workspace_id}/graphs", response_model=list[GraphOut])
async def list_graphs(workspace_id: UUID, db: AsyncSession = Depends(get_db)):
    graphs = await service.list_graphs(db, workspace_id)
    run_counts = await service.list_graph_run_counts(db, workspace_id)
    return [await _graph_out(db, g, run_count=run_counts.get(g.id, 0)) for g in graphs]


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


@router.get("/{workspace_id}/graphs/{graph_id}/versions", response_model=list[GraphVersionOut])
async def list_versions(
    workspace_id: UUID,
    graph_id: UUID,
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """List all named versions for a graph, with their attached drafts and run counts."""
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    versions = await version_service.list_versions(db, graph_id, include_archived=include_archived)
    out = []
    for v in versions:
        vo = GraphVersionOut.model_validate(v)
        vo.run_count = await version_service.get_version_run_count(db, v.id)
        draft = await version_service.get_draft_for_version(db, graph_id, v.id)
        vo.draft = GraphVersionOut.model_validate(draft) if draft else None
        out.append(vo)
    # Also append the root draft (no parent) if it exists
    root_draft = await version_service.get_draft_for_version(db, graph_id, None)
    if root_draft:
        out.append(GraphVersionOut.model_validate(root_draft))
    return out


@router.get("/{workspace_id}/graphs/{graph_id}/versions/{version_row_id}/draft", response_model=GraphVersionOut)
async def get_draft(
    workspace_id: UUID, graph_id: UUID, version_row_id: UUID, db: AsyncSession = Depends(get_db)
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    draft = await version_service.get_draft_for_version(db, graph_id, version_row_id)
    if not draft:
        raise HTTPException(404, "No draft for this version")
    return GraphVersionOut.model_validate(draft)


@router.put("/{workspace_id}/graphs/{graph_id}/versions/{version_row_id}/draft", response_model=GraphVersionOut)
async def upsert_draft(
    workspace_id: UUID,
    graph_id: UUID,
    version_row_id: UUID,
    data: DraftUpsertRequest,
    db: AsyncSession = Depends(get_db),
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    draft = await version_service.upsert_draft(
        db, graph_id, version_row_id, data.definition.model_dump()
    )
    return GraphVersionOut.model_validate(draft)


@router.put("/{workspace_id}/graphs/{graph_id}/root-draft", response_model=GraphVersionOut)
async def upsert_root_draft(
    workspace_id: UUID,
    graph_id: UUID,
    data: DraftUpsertRequest,
    db: AsyncSession = Depends(get_db),
):
    """Upsert the root draft (no parent version)."""
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    draft = await version_service.upsert_draft(
        db, graph_id, None, data.definition.model_dump()
    )
    return GraphVersionOut.model_validate(draft)


@router.post("/{workspace_id}/graphs/{graph_id}/versions/{version_row_id}/promote", response_model=GraphVersionOut, status_code=201)
async def promote_draft(
    workspace_id: UUID,
    graph_id: UUID,
    version_row_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Promote the draft of a version into a named version."""
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    try:
        version = await version_service.promote_draft_to_version(db, graph_id, version_row_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return GraphVersionOut.model_validate(version)


@router.post("/{workspace_id}/graphs/{graph_id}/root-draft/promote", response_model=GraphVersionOut, status_code=201)
async def promote_root_draft(
    workspace_id: UUID,
    graph_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Promote the root draft (no parent version) into the first named version."""
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    try:
        version = await version_service.promote_draft_to_version(db, graph_id, None)
    except ValueError as e:
        raise HTTPException(422, str(e))
    # Auto-set as production if no production version exists
    if graph.production_version_id is None:
        await version_service.set_production(db, graph_id, version.id)
    return GraphVersionOut.model_validate(version)


@router.patch("/{workspace_id}/graphs/{graph_id}/versions/{version_row_id}", response_model=GraphVersionOut)
async def rename_version(
    workspace_id: UUID,
    graph_id: UUID,
    version_row_id: UUID,
    data: VersionRenameRequest,
    db: AsyncSession = Depends(get_db),
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    try:
        version = await version_service.rename_version(db, graph_id, version_row_id, data.name)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return GraphVersionOut.model_validate(version)


@router.post("/{workspace_id}/graphs/{graph_id}/versions/{version_row_id}/production", response_model=GraphOut)
async def set_production(
    workspace_id: UUID,
    graph_id: UUID,
    version_row_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    try:
        graph = await version_service.set_production(db, graph_id, version_row_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return await _graph_out(db, graph)


@router.post("/{workspace_id}/graphs/{graph_id}/versions/{version_row_id}/archive", response_model=GraphVersionOut)
async def archive_version(
    workspace_id: UUID,
    graph_id: UUID,
    version_row_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    try:
        version = await version_service.archive_version(db, graph_id, version_row_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return GraphVersionOut.model_validate(version)


@router.post("/{workspace_id}/graphs/{graph_id}/versions/{version_row_id}/unarchive", response_model=GraphVersionOut)
async def unarchive_version(
    workspace_id: UUID,
    graph_id: UUID,
    version_row_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    try:
        version = await version_service.unarchive_version(db, graph_id, version_row_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return GraphVersionOut.model_validate(version)


@router.delete("/{workspace_id}/graphs/{graph_id}/versions/{version_row_id}", status_code=204)
async def delete_version(
    workspace_id: UUID,
    graph_id: UUID,
    version_row_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    try:
        await version_service.delete_version(db, graph_id, version_row_id)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/{workspace_id}/graphs/{graph_id}/versions/{version_row_id}/fork", response_model=GraphOut, status_code=201)
async def fork_version(
    workspace_id: UUID,
    graph_id: UUID,
    version_row_id: UUID,
    data: ForkRequest,
    db: AsyncSession = Depends(get_db),
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    try:
        new_graph = await version_service.fork_version(
            db, workspace_id, graph_id, version_row_id, data.name
        )
    except ValueError as e:
        raise HTTPException(422, str(e))
    return await _graph_out(db, new_graph)


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


@router.delete("/{workspace_id}/graphs/{graph_id}", response_model=GraphDeleteResult)
async def delete_graph(
    workspace_id: UUID, graph_id: UUID, db: AsyncSession = Depends(get_db)
):
    graph = await service.get_graph(db, graph_id)
    if not graph or graph.workspace_id != workspace_id:
        raise HTTPException(404, "Graph not found")
    result = await service.retire_graph(db, workspace_id, graph_id)
    if result is None:
        raise HTTPException(404, "Graph not found")
    action, run_count = result
    return GraphDeleteResult(action=action, run_count=run_count)


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
    """Return a specific graph version by row ID (used to show exact config of a run)."""
    from knotwork.graphs.models import GraphVersion
    version = await db.get(GraphVersion, version_id)
    if not version:
        raise HTTPException(404, "Version not found")
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
    # Designer uses the most recent draft definition (any draft)
    draft = await service.get_any_draft(db, graph.id)
    existing = draft.definition if draft else None
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

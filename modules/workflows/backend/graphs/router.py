from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db
from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User

from core.api import projects as core_projects
from . import service, version_service
from .schemas import (
    DesignWorkflowChatRequest,
    DesignWorkflowChatResponse,
    DraftUpsertRequest,
    ForkRequest,
    ImportMdRequest,
    WorkflowCreate,
    WorkflowDeleteResult,
    WorkflowDefinitionSchema,
    WorkflowOut,
    WorkflowUpdate,
    WorkflowVersionCreate,
    WorkflowVersionOut,
    VersionRenameRequest,
)

router = APIRouter(prefix="/workspaces", tags=["workflows"])


async def _workflow_out(db: AsyncSession, workflow, run_count: int | None = None) -> WorkflowOut:
    # Prefer the latest named version; fall back to the draft for new workflows.
    ver = await service.get_latest_version(db, workflow.id) or await service.get_root_draft(db, workflow.id)
    out = WorkflowOut.model_validate(workflow)
    if workflow.project_id is not None:
        project = await core_projects.get_project(db, workflow.project_id)
        out.project_slug = None if project is None else project.slug
    out.asset_path = service.graph_asset_path(workflow)
    out.run_count = run_count if run_count is not None else await service.count_graph_runs(db, workflow.workspace_id, workflow.id)
    out.latest_version = WorkflowVersionOut.model_validate(ver) if ver else None
    return out


@router.get("/{workspace_id}/workflows", response_model=list[WorkflowOut])
@router.get("/{workspace_id}/graphs", response_model=list[WorkflowOut], include_in_schema=False)
async def list_workflows(
    workspace_id: UUID,
    project_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    workflows = await service.list_graphs(db, workspace_id, project_id=project_id)
    run_counts = await service.list_graph_run_counts(db, workspace_id)
    return [await _workflow_out(db, workflow, run_count=run_counts.get(workflow.id, 0)) for workflow in workflows]


@router.post("/{workspace_id}/workflows", response_model=WorkflowOut, status_code=201)
@router.post("/{workspace_id}/graphs", response_model=WorkflowOut, status_code=201, include_in_schema=False)
async def create_workflow(
    workspace_id: UUID, data: WorkflowCreate, db: AsyncSession = Depends(get_db)
):
    workflow = await service.create_graph(db, workspace_id, data)
    return await _workflow_out(db, workflow)


@router.get("/{workspace_id}/workflows/by-path", response_model=WorkflowOut)
@router.get("/{workspace_id}/graphs/by-path", response_model=WorkflowOut, include_in_schema=False)
async def get_workflow_by_path(
    workspace_id: UUID,
    path: str = Query(...),
    project_id: UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    try:
        workflow = await service.get_graph_by_asset_path(db, workspace_id, path, project_id=project_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not workflow:
        raise HTTPException(404, "Workflow not found")
    return await _workflow_out(db, workflow)


@router.post("/{workspace_id}/workflows/import-md", response_model=WorkflowOut, status_code=201)
@router.post("/{workspace_id}/graphs/import-md", response_model=WorkflowOut, status_code=201, include_in_schema=False)
async def import_workflow_from_md(
    workspace_id: UUID, body: ImportMdRequest, db: AsyncSession = Depends(get_db)
):
    from .designer_parser import parse_md_to_graph
    from .schemas import WorkflowDefinitionSchema
    draft = parse_md_to_graph(body.content, body.name)
    data = WorkflowCreate(
        name=draft["name"],
        definition=WorkflowDefinitionSchema.model_validate({
            "nodes": draft["nodes"],
            "edges": draft["edges"],
            "entry_point": draft.get("entry_point"),
        }),
    )
    workflow = await service.create_graph(db, workspace_id, data)
    return await _workflow_out(db, workflow)


@router.get("/{workspace_id}/workflows/{workflow_id}", response_model=WorkflowOut)
@router.get("/{workspace_id}/graphs/{workflow_id}", response_model=WorkflowOut, include_in_schema=False)
async def get_workflow(
    workspace_id: UUID, workflow_id: UUID, db: AsyncSession = Depends(get_db)
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    return await _workflow_out(db, workflow)


@router.post("/{workspace_id}/workflows/{workflow_id}/versions", response_model=WorkflowVersionOut, status_code=201)
@router.post("/{workspace_id}/graphs/{workflow_id}/versions", response_model=WorkflowVersionOut, status_code=201, include_in_schema=False)
async def save_workflow_version(
    workspace_id: UUID,
    workflow_id: UUID,
    data: WorkflowVersionCreate,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    version = await service.save_version(db, workflow_id, data)
    return WorkflowVersionOut.model_validate(version)


@router.get("/{workspace_id}/workflows/{workflow_id}/versions", response_model=list[WorkflowVersionOut])
@router.get("/{workspace_id}/graphs/{workflow_id}/versions", response_model=list[WorkflowVersionOut], include_in_schema=False)
async def list_versions(
    workspace_id: UUID,
    workflow_id: UUID,
    include_archived: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """List all named versions for a workflow, with their attached drafts and run counts."""
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    versions = await version_service.list_versions(db, workflow_id, include_archived=include_archived)
    out = []
    for v in versions:
        vo = WorkflowVersionOut.model_validate(v)
        vo.run_count = await version_service.get_version_run_count(db, v.id)
        draft = await version_service.get_draft_for_version(db, workflow_id, v.id)
        vo.draft = WorkflowVersionOut.model_validate(draft) if draft else None
        out.append(vo)
    # Also append the workflow draft (no parent) if it exists.
    root_draft = await version_service.get_draft_for_version(db, workflow_id, None)
    if root_draft:
        out.append(WorkflowVersionOut.model_validate(root_draft))
    return out


@router.get("/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}/draft", response_model=WorkflowVersionOut)
@router.get("/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}/draft", response_model=WorkflowVersionOut, include_in_schema=False)
async def get_draft(
    workspace_id: UUID, workflow_id: UUID, workflow_version_id: UUID, db: AsyncSession = Depends(get_db)
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    draft = await version_service.get_draft_for_version(db, workflow_id, workflow_version_id)
    if not draft:
        raise HTTPException(404, "No draft for this version")
    return WorkflowVersionOut.model_validate(draft)


@router.get("/{workspace_id}/workflows/{workflow_id}/draft", response_model=WorkflowVersionOut)
@router.get("/{workspace_id}/graphs/{workflow_id}/root-draft", response_model=WorkflowVersionOut, include_in_schema=False)
async def get_workflow_draft(
    workspace_id: UUID,
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    draft = await version_service.get_draft_for_version(db, workflow_id, None)
    if not draft:
        raise HTTPException(404, "No workflow draft")
    return WorkflowVersionOut.model_validate(draft)


@router.put("/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}/draft", response_model=WorkflowVersionOut)
@router.put("/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}/draft", response_model=WorkflowVersionOut, include_in_schema=False)
async def upsert_draft(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    data: DraftUpsertRequest,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    draft = await version_service.upsert_draft(
        db, workflow_id, workflow_version_id, data.definition.model_dump()
    )
    return WorkflowVersionOut.model_validate(draft)


@router.put("/{workspace_id}/workflows/{workflow_id}/draft", response_model=WorkflowVersionOut)
@router.put("/{workspace_id}/graphs/{workflow_id}/root-draft", response_model=WorkflowVersionOut, include_in_schema=False)
async def upsert_workflow_draft(
    workspace_id: UUID,
    workflow_id: UUID,
    data: DraftUpsertRequest,
    db: AsyncSession = Depends(get_db),
):
    """Upsert the workflow draft (no parent version)."""
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    draft = await version_service.upsert_draft(
        db, workflow_id, None, data.definition.model_dump()
    )
    return WorkflowVersionOut.model_validate(draft)


@router.post("/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}/promote", response_model=WorkflowVersionOut, status_code=201)
@router.post("/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}/promote", response_model=WorkflowVersionOut, status_code=201, include_in_schema=False)
async def promote_draft(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Promote the draft of a version into a named version."""
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    try:
        version = await version_service.promote_draft_to_version(db, workflow_id, workflow_version_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return WorkflowVersionOut.model_validate(version)


@router.post("/{workspace_id}/workflows/{workflow_id}/draft/promote", response_model=WorkflowVersionOut, status_code=201)
@router.post("/{workspace_id}/graphs/{workflow_id}/root-draft/promote", response_model=WorkflowVersionOut, status_code=201, include_in_schema=False)
async def promote_workflow_draft(
    workspace_id: UUID,
    workflow_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Promote the workflow draft (no parent version) into the first named version."""
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    try:
        version = await version_service.promote_draft_to_version(db, workflow_id, None)
    except ValueError as e:
        raise HTTPException(422, str(e))
    # Auto-set as production if no production version exists
    if workflow.production_version_id is None:
        await version_service.set_production(db, workflow_id, version.id)
    return WorkflowVersionOut.model_validate(version)


@router.patch("/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}", response_model=WorkflowVersionOut)
@router.patch("/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}", response_model=WorkflowVersionOut, include_in_schema=False)
async def rename_version(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    data: VersionRenameRequest,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    try:
        version = await version_service.rename_version(db, workflow_id, workflow_version_id, data.name)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return WorkflowVersionOut.model_validate(version)


@router.post("/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}/production", response_model=WorkflowOut)
@router.post("/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}/production", response_model=WorkflowOut, include_in_schema=False)
async def set_production(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    try:
        workflow = await version_service.set_production(db, workflow_id, workflow_version_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return await _workflow_out(db, workflow)


@router.post("/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}/archive", response_model=WorkflowVersionOut)
@router.post("/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}/archive", response_model=WorkflowVersionOut, include_in_schema=False)
async def archive_version(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    try:
        version = await version_service.archive_version(db, workflow_id, workflow_version_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return WorkflowVersionOut.model_validate(version)


@router.post("/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}/unarchive", response_model=WorkflowVersionOut)
@router.post("/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}/unarchive", response_model=WorkflowVersionOut, include_in_schema=False)
async def unarchive_version(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    try:
        version = await version_service.unarchive_version(db, workflow_id, workflow_version_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return WorkflowVersionOut.model_validate(version)


@router.delete("/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}", status_code=204)
@router.delete("/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}", status_code=204, include_in_schema=False)
async def delete_version(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    try:
        await version_service.delete_version(db, workflow_id, workflow_version_id)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/{workspace_id}/workflows/{workflow_id}/versions/{workflow_version_id}/fork", response_model=WorkflowOut, status_code=201)
@router.post("/{workspace_id}/graphs/{workflow_id}/versions/{workflow_version_id}/fork", response_model=WorkflowOut, status_code=201, include_in_schema=False)
async def fork_version(
    workspace_id: UUID,
    workflow_id: UUID,
    workflow_version_id: UUID,
    data: ForkRequest,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    try:
        new_workflow = await version_service.fork_version(
            db, workspace_id, workflow_id, workflow_version_id, data.name
        )
    except ValueError as e:
        raise HTTPException(422, str(e))
    return await _workflow_out(db, new_workflow)


@router.patch("/{workspace_id}/workflows/{workflow_id}", response_model=WorkflowOut)
@router.patch("/{workspace_id}/graphs/{workflow_id}", response_model=WorkflowOut, include_in_schema=False)
async def update_workflow(
    workspace_id: UUID,
    workflow_id: UUID,
    data: WorkflowUpdate,
    db: AsyncSession = Depends(get_db),
):
    workflow = await service.update_graph(db, workflow_id, data)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    return await _workflow_out(db, workflow)


@router.delete("/{workspace_id}/workflows/{workflow_id}", response_model=WorkflowDeleteResult)
@router.delete("/{workspace_id}/graphs/{workflow_id}", response_model=WorkflowDeleteResult, include_in_schema=False)
async def delete_workflow(
    workspace_id: UUID, workflow_id: UUID, db: AsyncSession = Depends(get_db)
):
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    result = await service.retire_graph(db, workspace_id, workflow_id)
    if result is None:
        raise HTTPException(404, "Workflow not found")
    action, run_count = result
    return WorkflowDeleteResult(action=action, run_count=run_count)


@router.get("/{workspace_id}/workflows/versions/{workflow_version_id}", response_model=WorkflowVersionOut)
@router.get("/{workspace_id}/graphs/versions/{workflow_version_id}", response_model=WorkflowVersionOut, include_in_schema=False)
async def get_workflow_version(
    workspace_id: UUID, workflow_version_id: UUID, db: AsyncSession = Depends(get_db)
):
    """Return a specific workflow version by row ID (used to show exact config of a run)."""
    from .models import GraphVersion
    version = await db.get(GraphVersion, workflow_version_id)
    if not version:
        raise HTTPException(404, "Version not found")
    workflow = await service.get_graph(db, version.graph_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Version not found")
    return WorkflowVersionOut.model_validate(version)


@router.post("/{workspace_id}/workflows/design/chat", response_model=DesignWorkflowChatResponse)
@router.post("/{workspace_id}/graphs/design/chat", response_model=DesignWorkflowChatResponse, include_in_schema=False)
async def design_chat(
    workspace_id: UUID,
    body: DesignWorkflowChatRequest,
    user: User = Depends(get_current_user),
    member=Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
):
    from .designer_agent import design_graph
    from libs.participants import member_participant_id
    workflow = await service.get_graph(db, UUID(body.workflow_id))
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    # Designer uses the most recent draft definition (any draft)
    draft = await service.get_any_draft(db, workflow.id)
    existing = draft.definition if draft else None
    result = await design_graph(
        session_id=body.session_id,
        message=body.message,
        workspace_id=str(workspace_id),
        existing_graph=existing,
        db=db,
        graph_id=str(workflow.id),
        requester_participant_id=member_participant_id(member, user.id),
    )
    return DesignWorkflowChatResponse(**result)


@router.get("/{workspace_id}/workflows/{workflow_id}/designer-messages")
@router.get("/{workspace_id}/graphs/{workflow_id}/designer-messages", include_in_schema=False)
async def list_designer_messages(
    workspace_id: UUID, workflow_id: UUID, db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import select
    from modules.communication.backend.channels_models import Channel, ChannelMessage
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    channel_id = (
        await db.execute(
            select(Channel.id).where(
                Channel.workspace_id == workspace_id,
                Channel.graph_id == workflow_id,
                Channel.channel_type == "workflow",
                Channel.archived_at.is_(None),
            ).limit(1)
        )
    ).scalar_one_or_none()
    if channel_id is None:
        return []
    result = await db.execute(
        select(ChannelMessage)
        .where(ChannelMessage.channel_id == channel_id)
        .order_by(ChannelMessage.created_at.asc())
    )
    msgs = result.scalars().all()
    return [
        {
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
            "author_name": m.author_name,
        }
        for m in msgs
    ]


@router.delete("/{workspace_id}/workflows/{workflow_id}/designer-messages", status_code=204)
@router.delete("/{workspace_id}/graphs/{workflow_id}/designer-messages", status_code=204, include_in_schema=False)
async def clear_designer_messages(
    workspace_id: UUID, workflow_id: UUID, db: AsyncSession = Depends(get_db)
):
    from sqlalchemy import delete
    from modules.communication.backend.channels_models import Channel, ChannelMessage
    workflow = await service.get_graph(db, workflow_id)
    if not workflow or workflow.workspace_id != workspace_id:
        raise HTTPException(404, "Workflow not found")
    channel_id = (
        await db.execute(
            select(Channel.id).where(
                Channel.workspace_id == workspace_id,
                Channel.graph_id == workflow_id,
                Channel.channel_type == "workflow",
                Channel.archived_at.is_(None),
            ).limit(1)
        )
    ).scalar_one_or_none()
    if channel_id is None:
        return
    await db.execute(
        delete(ChannelMessage).where(ChannelMessage.channel_id == channel_id)
    )
    await db.commit()

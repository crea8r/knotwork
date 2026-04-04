"""
Knowledge change review endpoints.

Agents propose structured knowledge changes that are discussed in normal channels.
Approving a change applies the requested action to the underlying knowledge asset.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels.models import Channel
from knotwork.database import get_db

router = APIRouter(prefix="/workspaces", tags=["proposals"])


class KnowledgeChangeOut(BaseModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID | None = None
    channel_id: UUID
    run_id: str | None = None
    node_id: str | None = None
    agent_ref: str | None = None
    action_type: str
    target_type: str
    target_path: str
    proposed_content: str | None = None
    payload: dict = {}
    reason: str
    status: str
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None
    final_content: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class KnowledgeChangeReview(BaseModel):
    final_content: str | None = None


class KnowledgeChangeCreate(BaseModel):
    path: str
    proposed_content: str
    reason: str
    run_id: str | None = None
    node_id: str | None = None
    agent_ref: str | None = None
    source_channel_id: UUID | None = None
    action_type: str = "update_content"
    target_type: str = "file"
    payload: dict = {}


async def _get_change_for_workspace(db: AsyncSession, workspace_id: UUID, change_id: UUID):
    from knotwork.knowledge.models import KnowledgeChange

    change = await db.get(KnowledgeChange, change_id)
    if not change:
        raise HTTPException(404, "Knowledge change not found")
    channel = await db.get(Channel, change.channel_id)
    if channel is None or channel.workspace_id != workspace_id:
        raise HTTPException(404, "Knowledge change not found")
    return change


@router.get("/{workspace_id}/handbook/proposals", response_model=list[KnowledgeChangeOut])
async def list_handbook_proposals(
    workspace_id: UUID,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    from knotwork.knowledge.models import KnowledgeChange

    q = (
        select(KnowledgeChange)
        .where(KnowledgeChange.workspace_id == workspace_id)
        .order_by(KnowledgeChange.created_at.desc())
    )
    if status:
        q = q.where(KnowledgeChange.status == status)
    result = await db.execute(q)
    return list(result.scalars())


@router.get("/{workspace_id}/knowledge/changes", response_model=list[KnowledgeChangeOut])
async def list_knowledge_changes(
    workspace_id: UUID,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await list_handbook_proposals(workspace_id=workspace_id, status=status, db=db)


@router.post("/{workspace_id}/knowledge/changes", response_model=KnowledgeChangeOut, status_code=201)
async def create_knowledge_change(
    workspace_id: UUID,
    body: KnowledgeChangeCreate,
    db: AsyncSession = Depends(get_db),
):
    from knotwork.knowledge.change_service import create_knowledge_change as create_change

    return await create_change(
        db,
        workspace_id=workspace_id,
        path=body.path,
        proposed_content=body.proposed_content,
        reason=body.reason,
        run_id=body.run_id,
        node_id=body.node_id,
        agent_ref=body.agent_ref,
        source_channel_id=body.source_channel_id,
        action_type=body.action_type,
        target_type=body.target_type,
        payload=body.payload,
    )


async def _apply_change(db: AsyncSession, workspace_id: UUID, change, final_content: str | None) -> None:
    from knotwork.knowledge import folder_service, service as knowledge_service

    action_type = change.action_type
    target_type = change.target_type
    target_path = change.target_path
    payload = dict(change.payload or {})

    if action_type == "update_content" and target_type == "file":
        content_to_write = final_content or change.proposed_content
        if not content_to_write:
            raise HTTPException(400, "Knowledge change is missing proposed content")
        existing = await knowledge_service.get_file_by_path(db, workspace_id, target_path)
        if existing:
            await knowledge_service.update_file(
                db,
                workspace_id,
                target_path,
                content_to_write,
                updated_by="knowledge_change",
                change_summary=f"Approved change: {change.reason[:80]}",
            )
        else:
            title = target_path.split("/")[-1].replace("-", " ").replace("_", " ").title()
            await knowledge_service.create_file(
                db,
                workspace_id,
                target_path,
                title,
                content_to_write,
                created_by="knowledge_change",
                change_summary=f"Approved change: {change.reason[:80]}",
            )
        change.final_content = content_to_write
        return

    if action_type == "move" and target_type == "file":
        new_path = str(payload.get("new_path") or "").strip("/")
        if not new_path:
            raise HTTPException(400, "Knowledge change move is missing new_path")
        await knowledge_service.rename_file(db, workspace_id, target_path, new_path)
        return

    if action_type == "move" and target_type == "folder":
        new_path = str(payload.get("new_path") or "").strip("/")
        if not new_path:
            raise HTTPException(400, "Knowledge change move is missing new_path")
        await folder_service.rename_folder(db, workspace_id, target_path, new_path)
        return

    if action_type == "create" and target_type == "folder":
        await folder_service.create_folder(db, workspace_id, target_path)
        return

    if action_type == "delete" and target_type == "file":
        await knowledge_service.delete_file(db, workspace_id, target_path, deleted_by="knowledge_change")
        return

    if action_type == "delete" and target_type == "folder":
        await folder_service.delete_folder(db, workspace_id, target_path)
        return

    raise HTTPException(400, f"Unsupported knowledge change action: {action_type}:{target_type}")


@router.post("/{workspace_id}/handbook/proposals/{proposal_id}/approve", response_model=KnowledgeChangeOut)
async def approve_handbook_proposal(
    workspace_id: UUID,
    proposal_id: UUID,
    body: KnowledgeChangeReview,
    db: AsyncSession = Depends(get_db),
):
    change = await _get_change_for_workspace(db, workspace_id, proposal_id)
    if change.status != "pending":
        raise HTTPException(409, f"Knowledge change is already {change.status}")

    await _apply_change(db, workspace_id, change, body.final_content)
    change.status = "approved"
    change.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(change)
    return change


@router.post("/{workspace_id}/knowledge/changes/{proposal_id}/approve", response_model=KnowledgeChangeOut)
async def approve_knowledge_change(
    workspace_id: UUID,
    proposal_id: UUID,
    body: KnowledgeChangeReview,
    db: AsyncSession = Depends(get_db),
):
    return await approve_handbook_proposal(workspace_id=workspace_id, proposal_id=proposal_id, body=body, db=db)


@router.post("/{workspace_id}/handbook/proposals/{proposal_id}/reject", response_model=KnowledgeChangeOut)
async def reject_handbook_proposal(
    workspace_id: UUID,
    proposal_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    change = await _get_change_for_workspace(db, workspace_id, proposal_id)
    if change.status != "pending":
        raise HTTPException(409, f"Knowledge change is already {change.status}")
    change.status = "rejected"
    change.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(change)
    return change


@router.post("/{workspace_id}/knowledge/changes/{proposal_id}/reject", response_model=KnowledgeChangeOut)
async def reject_knowledge_change(
    workspace_id: UUID,
    proposal_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await reject_handbook_proposal(workspace_id=workspace_id, proposal_id=proposal_id, db=db)

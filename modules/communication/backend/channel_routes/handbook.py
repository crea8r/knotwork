from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api import knowledge as core_knowledge
from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User
from libs.database import get_db

from .. import channels_service as service
from ..channels_models import DecisionEvent
from ..channels_schemas import ChannelKnowledgeChangeResolveRequest, ChannelMessageCreate, DecisionEventCreate, HandbookChatAskRequest, HandbookChatAskResponse, HandbookProposalResolveRequest
from .deps import caller_participant_id

router = APIRouter()


@router.post("/{workspace_id}/channels/{channel_ref}/handbook/ask", response_model=HandbookChatAskResponse)
async def ask_handbook_chat(workspace_id: UUID, channel_ref: str, body: HandbookChatAskRequest, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    from ..handbook_agent import ask_handbook_agent

    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    if channel.channel_type != "handbook":
        raise HTTPException(400, "Channel is not a handbook channel")
    user_text = body.message.strip()
    if not user_text:
        raise HTTPException(400, "message is required")

    await service.create_message(db, workspace_id, channel.id, ChannelMessageCreate(role="user", author_type="human", author_name=user.name, content=user_text, metadata={"intent": "handbook_edit_request", "author_participant_id": caller_participant_id(user, member)}))
    result = await ask_handbook_agent(db, workspace_id, user_text)
    await service.create_message(db, workspace_id, channel.id, ChannelMessageCreate(role="assistant", author_type="agent", author_name="Knotwork Agent", content=result["reply"], metadata={"source": "handbook_agent"}))

    proposal = result.get("proposal")
    proposal_id = str(proposal.get("proposal_id")) if isinstance(proposal, dict) else None
    decision_payload = proposal if isinstance(proposal, dict) else {"request": user_text}
    decision_type = "knowledge_change" if isinstance(proposal, dict) else "handbook_change_requested"
    actor_type = "agent" if isinstance(proposal, dict) else "human"
    actor_name = "Knotwork Agent" if isinstance(proposal, dict) else user.name
    await service.create_decision(db, workspace_id, channel.id, DecisionEventCreate(decision_type=decision_type, actor_type=actor_type, actor_name=actor_name, payload=decision_payload))
    return HandbookChatAskResponse(reply=result["reply"], proposal_id=proposal_id)


@router.post("/{workspace_id}/channels/{channel_ref}/handbook/proposals/{proposal_id}/resolve")
async def resolve_handbook_knowledge_change_legacy(workspace_id: UUID, channel_ref: str, proposal_id: str, body: HandbookProposalResolveRequest, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    return await resolve_knowledge_change(workspace_id=workspace_id, channel_ref=channel_ref, proposal_id=proposal_id, body=body, _member=_member, db=db)


@router.post("/{workspace_id}/channels/{channel_ref}/knowledge/changes/{proposal_id}/resolve")
async def resolve_knowledge_change(workspace_id: UUID, channel_ref: str, proposal_id: str, body: HandbookProposalResolveRequest, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    if channel.channel_type != "handbook":
        raise HTTPException(400, "Channel is not a handbook channel")
    target = await _knowledge_decision(db, workspace_id, channel.id, proposal_id)
    payload = dict(target.payload or {})
    if payload.get("status") != "pending":
        raise HTTPException(409, f"Proposal is already {payload.get('status')}")

    if body.resolution in ("accept_output", "override_output"):
        path = str(payload.get("path") or "").strip()
        content = (body.final_content or str(payload.get("proposed_content") or "")).strip()
        reason = str(payload.get("reason") or "Approved from handbook chat").strip()
        if not path or not content:
            raise HTTPException(400, "Proposal payload is invalid")
        existing = await core_knowledge.get_file_by_path(db, workspace_id, path)
        if existing:
            await core_knowledge.update_file(db, workspace_id, path, content, updated_by="handbook_chat", change_summary=f"Handbook chat: {reason[:80]}")
        else:
            title = path.split("/")[-1].replace("-", " ").replace("_", " ").title()
            await core_knowledge.create_file(db, workspace_id, path, title, content, created_by="handbook_chat", change_summary=f"Handbook chat: {reason[:80]}")
        payload.update({"status": "approved", "final_content": content})
    else:
        payload["status"] = "aborted"

    target.payload = payload
    await db.commit()
    await db.refresh(target)
    message = f"Proposal {proposal_id} approved and applied to {payload.get('path')}." if payload["status"] == "approved" else f"Proposal {proposal_id} was aborted."
    await service.create_message(db, workspace_id, channel.id, ChannelMessageCreate(role="assistant", author_type="agent", author_name="Knotwork Agent", content=message, metadata={"source": "handbook_agent"}))
    return {"status": payload["status"], "proposal_id": proposal_id}


@router.post("/{workspace_id}/channels/{channel_ref}/knowledge/changes/{proposal_id}/review")
async def resolve_inline_knowledge_change(workspace_id: UUID, channel_ref: str, proposal_id: UUID, body: ChannelKnowledgeChangeResolveRequest, user: User = Depends(get_current_user), _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    change = await core_knowledge.get_change(db, proposal_id)
    if not change or change.workspace_id != workspace_id or change.channel_id != channel.id:
        raise HTTPException(404, "Knowledge change not found")
    if change.status != "pending":
        raise HTTPException(409, f"Knowledge change is already {change.status}")

    if body.resolution == "approve":
        await core_knowledge.apply_change(db, workspace_id, change, body.final_content)
        change.status = "approved"
        change.reviewed_at = datetime.now(timezone.utc)
        await core_knowledge.update_inline_proposal_message(db, channel_id=channel.id, proposal_id=change.id, updates={"status": "approved", "final_content": body.final_content or change.proposed_content})
        await db.commit()
        await db.refresh(change)
        await service.create_message(db, workspace_id, channel.id, ChannelMessageCreate(role="system", author_type="system", author_name="Knotwork", content=f"Approved and applied the knowledge change for `{change.target_path}`.", metadata={"kind": "knowledge_change_resolved", "proposal_id": str(change.id), "status": "approved"}))
        return {"status": "approved", "proposal_id": str(change.id)}

    comment = (body.comment or "").strip()
    if not comment:
        raise HTTPException(400, "comment is required when requesting an edit")
    change.status = "needs_revision"
    change.reviewed_at = datetime.now(timezone.utc)
    await core_knowledge.update_inline_proposal_message(db, channel_id=channel.id, proposal_id=change.id, updates={"status": "needs_revision", "revision_request_comment": comment, "revision_requested_by": user.name})
    await db.commit()
    await db.refresh(change)
    await service.create_message(db, workspace_id, channel.id, ChannelMessageCreate(role="user", author_type="human", author_name=user.name, content=comment, metadata={"kind": "knowledge_change_revision_requested", "proposal_id": str(change.id), "path": change.target_path}))
    return {"status": "needs_revision", "proposal_id": str(change.id)}


async def _knowledge_decision(db: AsyncSession, workspace_id: UUID, channel_id: UUID, proposal_id: str) -> DecisionEvent:
    rows = await db.execute(
        select(DecisionEvent)
        .where(DecisionEvent.workspace_id == workspace_id, DecisionEvent.channel_id == channel_id, DecisionEvent.decision_type == "knowledge_change")
        .order_by(DecisionEvent.created_at.desc())
    )
    for event in rows.scalars():
        if str((event.payload or {}).get("proposal_id")) == proposal_id:
            return event
    raise HTTPException(404, "Proposal not found")

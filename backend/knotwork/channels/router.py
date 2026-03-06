from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.channels import service
from knotwork.channels.schemas import (
    ChannelCreate,
    HandbookChatAskRequest,
    HandbookChatAskResponse,
    HandbookProposalResolveRequest,
    ChannelMessageCreate,
    ChannelMessageOut,
    ChannelOut,
    DecisionEventCreate,
    DecisionEventOut,
    InboxItem,
)
from knotwork.database import get_db


router = APIRouter(prefix="/workspaces", tags=["channels"])


@router.get("/{workspace_id}/channels", response_model=list[ChannelOut])
async def list_channels(workspace_id: UUID, db: AsyncSession = Depends(get_db)):
    rows = await service.list_channels(db, workspace_id)
    return [ChannelOut.model_validate(r) for r in rows]


@router.post("/{workspace_id}/channels", response_model=ChannelOut, status_code=201)
async def create_channel(
    workspace_id: UUID,
    data: ChannelCreate,
    db: AsyncSession = Depends(get_db),
):
    try:
        ch = await service.create_channel(db, workspace_id, data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return ChannelOut.model_validate(ch)


@router.get("/{workspace_id}/channels/{channel_id}", response_model=ChannelOut)
async def get_channel(workspace_id: UUID, channel_id: UUID, db: AsyncSession = Depends(get_db)):
    ch = await service.get_channel(db, workspace_id, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    return ChannelOut.model_validate(ch)


@router.get("/{workspace_id}/channels/{channel_id}/messages", response_model=list[ChannelMessageOut])
async def list_messages(workspace_id: UUID, channel_id: UUID, db: AsyncSession = Depends(get_db)):
    ch = await service.get_channel(db, workspace_id, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    rows = await service.list_messages(db, workspace_id, channel_id)
    return [ChannelMessageOut.model_validate(r) for r in rows]


@router.post("/{workspace_id}/channels/{channel_id}/messages", response_model=ChannelMessageOut, status_code=201)
async def create_message(
    workspace_id: UUID,
    channel_id: UUID,
    data: ChannelMessageCreate,
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    msg = await service.create_message(db, workspace_id, channel_id, data)
    return ChannelMessageOut.model_validate(msg)


@router.get("/{workspace_id}/channels/{channel_id}/decisions", response_model=list[DecisionEventOut])
async def list_decisions(workspace_id: UUID, channel_id: UUID, db: AsyncSession = Depends(get_db)):
    ch = await service.get_channel(db, workspace_id, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    rows = await service.list_decisions(db, workspace_id, channel_id)
    return [DecisionEventOut.model_validate(r) for r in rows]


@router.post("/{workspace_id}/channels/{channel_id}/decisions", response_model=DecisionEventOut, status_code=201)
async def create_decision(
    workspace_id: UUID,
    channel_id: UUID,
    data: DecisionEventCreate,
    db: AsyncSession = Depends(get_db),
):
    ch = await service.get_channel(db, workspace_id, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    event = await service.create_decision(db, workspace_id, channel_id, data)
    return DecisionEventOut.model_validate(event)


@router.post(
    "/{workspace_id}/channels/{channel_id}/handbook/ask",
    response_model=HandbookChatAskResponse,
)
async def ask_handbook_chat(
    workspace_id: UUID,
    channel_id: UUID,
    body: HandbookChatAskRequest,
    db: AsyncSession = Depends(get_db),
):
    from knotwork.channels.handbook_agent import ask_handbook_agent

    ch = await service.get_channel(db, workspace_id, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    if ch.channel_type != "handbook":
        raise HTTPException(400, "Channel is not a handbook channel")

    user_text = body.message.strip()
    if not user_text:
        raise HTTPException(400, "message is required")

    await service.create_message(
        db,
        workspace_id,
        channel_id,
        ChannelMessageCreate(
            role="user",
            author_type="human",
            author_name="You",
            content=user_text,
            metadata={"intent": "handbook_edit_request"},
        ),
    )

    result = await ask_handbook_agent(db, workspace_id, user_text)

    await service.create_message(
        db,
        workspace_id,
        channel_id,
        ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            author_name="Knotwork Agent",
            content=result["reply"],
            metadata={"source": "handbook_agent"},
        ),
    )

    proposal_id: str | None = None
    proposal = result.get("proposal")
    if isinstance(proposal, dict):
        proposal_id = str(proposal.get("proposal_id"))
        await service.create_decision(
            db,
            workspace_id,
            channel_id,
            DecisionEventCreate(
                decision_type="handbook_proposal",
                actor_type="agent",
                actor_name="Knotwork Agent",
                payload=proposal,
            ),
        )
    else:
        await service.create_decision(
            db,
            workspace_id,
            channel_id,
            DecisionEventCreate(
                decision_type="handbook_change_requested",
                actor_type="human",
                actor_name="You",
                payload={"request": user_text},
            ),
        )

    return HandbookChatAskResponse(reply=result["reply"], proposal_id=proposal_id)


@router.post("/{workspace_id}/channels/{channel_id}/handbook/proposals/{proposal_id}/resolve")
async def resolve_handbook_proposal(
    workspace_id: UUID,
    channel_id: UUID,
    proposal_id: str,
    body: HandbookProposalResolveRequest,
    db: AsyncSession = Depends(get_db),
):
    from knotwork.channels.models import DecisionEvent
    from knotwork.knowledge import service as knowledge_service

    ch = await service.get_channel(db, workspace_id, channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    if ch.channel_type != "handbook":
        raise HTTPException(400, "Channel is not a handbook channel")

    rows = await db.execute(
        select(DecisionEvent)
        .where(
            DecisionEvent.workspace_id == workspace_id,
            DecisionEvent.channel_id == channel_id,
            DecisionEvent.decision_type == "handbook_proposal",
        )
        .order_by(DecisionEvent.created_at.desc())
    )
    target: DecisionEvent | None = None
    for event in rows.scalars():
        payload = event.payload or {}
        if str(payload.get("proposal_id")) == proposal_id:
            target = event
            break

    if not target:
        raise HTTPException(404, "Proposal not found")

    payload = dict(target.payload or {})
    if payload.get("status") != "pending":
        raise HTTPException(409, f"Proposal is already {payload.get('status')}")

    if body.resolution in ("accept_output", "override_output"):
        path = str(payload.get("path") or "").strip()
        content = (body.final_content or str(payload.get("proposed_content") or "")).strip()
        reason = str(payload.get("reason") or "Approved from handbook chat").strip()
        if not path or not content:
            raise HTTPException(400, "Proposal payload is invalid")

        existing = await knowledge_service.get_file_by_path(db, workspace_id, path)
        if existing:
            await knowledge_service.update_file(
                db,
                workspace_id,
                path,
                content,
                updated_by="handbook_chat",
                change_summary=f"Handbook chat: {reason[:80]}",
            )
        else:
            title = path.split("/")[-1].replace("-", " ").replace("_", " ").title()
            await knowledge_service.create_file(
                db,
                workspace_id,
                path,
                title,
                content,
                created_by="handbook_chat",
                change_summary=f"Handbook chat: {reason[:80]}",
            )
        payload["status"] = "approved"
        payload["final_content"] = content
    else:
        payload["status"] = "aborted"

    target.payload = payload
    await db.commit()
    await db.refresh(target)

    await service.create_message(
        db,
        workspace_id,
        channel_id,
        ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            author_name="Knotwork Agent",
            content=(
                f"Proposal {proposal_id} approved and applied to {payload.get('path')}."
                if payload["status"] == "approved"
                else f"Proposal {proposal_id} was aborted."
            ),
            metadata={"source": "handbook_agent"},
        ),
    )

    return {"status": payload["status"], "proposal_id": proposal_id}


@router.get("/{workspace_id}/inbox", response_model=list[InboxItem])
async def get_inbox(workspace_id: UUID, db: AsyncSession = Depends(get_db)):
    rows = await service.inbox_items(db, workspace_id)
    return [InboxItem.model_validate(r) for r in rows]

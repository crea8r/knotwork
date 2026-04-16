from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User
from libs.database import get_db
from libs.participants import list_workspace_participants
from modules.workflows.backend.runs.human_review import normalize_resolution, respond_to_run_message

from .. import channels_service as service
from ..channels_models import ChannelMessage
from ..channels_schemas import ChannelMessageCreate, ChannelMessageOut, ChannelMessageRespondRequest, ChannelParticipantOut, ChannelSubscriptionUpdate, DecisionEventCreate, DecisionEventOut
from .deps import caller_participant_id, require_consultation_access

router = APIRouter()


@router.get("/{workspace_id}/channels/{channel_ref}/messages", response_model=list[ChannelMessageOut])
async def list_messages(workspace_id: UUID, channel_ref: str, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    await require_consultation_access(db, workspace_id, channel, user, member)
    return [ChannelMessageOut.model_validate(row) for row in await service.list_messages(db, workspace_id, channel.id)]


@router.post("/{workspace_id}/channels/{channel_ref}/messages", response_model=ChannelMessageOut, status_code=201)
async def create_message(workspace_id: UUID, channel_ref: str, data: ChannelMessageCreate, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    await require_consultation_access(db, workspace_id, channel, user, member)
    payload = data.model_copy(update={"metadata": {**(data.metadata or {}), "author_participant_id": caller_participant_id(user, member)}, "author_name": user.name if data.author_type == "human" else data.author_name})
    return ChannelMessageOut.model_validate(await service.create_message(db, workspace_id, channel.id, payload))


@router.post("/{workspace_id}/channels/{channel_ref}/messages/{message_id}/respond", response_model=ChannelMessageOut, status_code=201)
async def respond_to_message(workspace_id: UUID, channel_ref: str, message_id: UUID, data: ChannelMessageRespondRequest, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    await require_consultation_access(db, workspace_id, channel, user, member)
    request_message = await db.get(ChannelMessage, message_id)
    if not request_message or request_message.workspace_id != workspace_id or request_message.channel_id != channel.id:
        raise HTTPException(404, "Message not found")
    if normalize_resolution(data.resolution) == "request_revision" and not ((data.guidance or "").strip() or any(str(answer).strip() for answer in (data.answers or []))):
        raise HTTPException(status_code=400, detail="request_revision requires guidance or at least one answer")
    try:
        response_message = await respond_to_run_message(db, workspace_id=workspace_id, channel_ref=channel.id, message_id=message_id, current_user=user, member=member, data=data)
    except ValueError as exc:
        detail = str(exc)
        status = 404 if detail in {"Channel not found", "Message not found", "Linked orchestration request not found"} else 400
        raise HTTPException(status, detail)
    return ChannelMessageOut.model_validate(response_message)


@router.get("/{workspace_id}/channels/{channel_ref}/participants", response_model=list[ChannelParticipantOut])
async def list_channel_participants(workspace_id: UUID, channel_ref: str, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    try:
        rows = await service.list_channel_participants(db, workspace_id, channel.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return [ChannelParticipantOut.model_validate(row) for row in rows]


@router.patch("/{workspace_id}/channels/{channel_ref}/participants/{participant_id:path}", response_model=ChannelParticipantOut)
async def update_channel_participant(workspace_id: UUID, channel_ref: str, participant_id: str, data: ChannelSubscriptionUpdate, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    if participant_id != caller_participant_id(user, member) and not data.subscribed and member.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can remove other channel participants")
    participants = await list_workspace_participants(db, workspace_id)
    if not any(row["participant_id"] == participant_id for row in participants):
        raise HTTPException(status_code=404, detail="Participant not found")
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    try:
        await service.set_channel_subscription(db, workspace_id, channel.id, participant_id, subscribed=data.subscribed)
        rows = await service.list_channel_participants(db, workspace_id, channel.id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    row = next((item for item in rows if item["participant_id"] == participant_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Participant not found")
    return ChannelParticipantOut.model_validate(row)


@router.get("/{workspace_id}/channels/{channel_ref}/decisions", response_model=list[DecisionEventOut])
async def list_decisions(workspace_id: UUID, channel_ref: str, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    await require_consultation_access(db, workspace_id, channel, user, member)
    return [DecisionEventOut.model_validate(row) for row in await service.list_decisions(db, workspace_id, channel.id)]


@router.post("/{workspace_id}/channels/{channel_ref}/decisions", response_model=DecisionEventOut, status_code=201)
async def create_decision(workspace_id: UUID, channel_ref: str, data: DecisionEventCreate, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    return DecisionEventOut.model_validate(await service.create_decision(db, workspace_id, channel.id, data))

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User
from libs.database import get_db
from libs.participants import list_workspace_participants

from .. import channels_service as service
from ..channels_schemas import ChannelCreate, ChannelOut, ChannelUpdate, ParticipantMentionOption
from .deps import caller_participant_id

router = APIRouter()


@router.get("/{workspace_id}/channels", response_model=list[ChannelOut])
async def list_channels(workspace_id: UUID, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    return [ChannelOut.model_validate(row) for row in await service.list_channels(db, workspace_id)]


@router.get("/{workspace_id}/participants", response_model=list[ParticipantMentionOption])
async def list_participants(workspace_id: UUID, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    return [ParticipantMentionOption.model_validate(row) for row in await list_workspace_participants(db, workspace_id)]


@router.post("/{workspace_id}/channels", response_model=ChannelOut, status_code=201)
async def create_channel(workspace_id: UUID, data: ChannelCreate, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    try:
        channel = await service.create_channel(db, workspace_id, data, initial_participant_id=caller_participant_id(user, member))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return ChannelOut.model_validate(channel)


@router.get("/{workspace_id}/channels/{channel_ref}", response_model=ChannelOut)
async def get_channel(workspace_id: UUID, channel_ref: str, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    from .deps import require_consultation_access

    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    await require_consultation_access(db, workspace_id, channel, user, member)
    return ChannelOut.model_validate(channel)


@router.patch("/{workspace_id}/channels/{channel_ref}", response_model=ChannelOut)
async def update_channel(workspace_id: UUID, channel_ref: str, data: ChannelUpdate, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    try:
        channel = await service.update_channel(db, workspace_id, channel_ref, data)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not channel:
        raise HTTPException(404, "Channel not found")
    return ChannelOut.model_validate(channel)


@router.post("/{workspace_id}/objectives/{objective_id}/agentzero-consultation", response_model=ChannelOut, status_code=201)
async def get_objective_agentzero_consultation(workspace_id: UUID, objective_id: UUID, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    try:
        channel = await service.get_or_create_objective_agentzero_consultation(db, workspace_id, objective_id, requester_member=member, requester_user=user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return ChannelOut.model_validate(channel)


@router.post("/{workspace_id}/graphs/{graph_id}/agentzero-consultation", response_model=ChannelOut, status_code=201)
async def get_graph_agentzero_consultation(workspace_id: UUID, graph_id: UUID, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    try:
        channel = await service.get_or_create_graph_agentzero_consultation(db, workspace_id, graph_id, requester_member=member, requester_user=user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return ChannelOut.model_validate(channel)


@router.get("/{workspace_id}/channels/asset-chat/resolve", response_model=ChannelOut)
async def get_asset_chat_channel(workspace_id: UUID, asset_type: str = Query(...), path: str | None = Query(None), asset_id: str | None = Query(None), project_id: UUID | None = Query(None), _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    try:
        channel = await service.get_or_create_asset_chat_channel(db, workspace_id, asset_type=asset_type, path=path, asset_id=asset_id, project_id=project_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return ChannelOut.model_validate(channel)

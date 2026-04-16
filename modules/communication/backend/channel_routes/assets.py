from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from libs.auth.backend.deps import get_workspace_member
from libs.database import get_db

from .. import channels_service as service
from ..channels_schemas import ChannelAssetBindingCreate, ChannelAssetBindingOut

router = APIRouter()


@router.get("/{workspace_id}/channels/{channel_ref}/assets", response_model=list[ChannelAssetBindingOut])
async def get_channel_assets(workspace_id: UUID, channel_ref: str, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    return [ChannelAssetBindingOut.model_validate(row) for row in await service.list_channel_asset_bindings(db, workspace_id, channel.id)]


@router.post("/{workspace_id}/channels/{channel_ref}/assets", response_model=ChannelAssetBindingOut, status_code=201)
async def attach_channel_asset(workspace_id: UUID, channel_ref: str, data: ChannelAssetBindingCreate, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    try:
        binding = await service.attach_asset_to_channel(db, workspace_id, channel.id, asset_type=data.asset_type, asset_id=data.asset_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    rows = await service.list_channel_asset_bindings(db, workspace_id, channel.id)
    row = next((item for item in rows if item["id"] == str(binding.id)), None)
    if row is None:
        raise HTTPException(500, "Attached asset could not be loaded")
    return ChannelAssetBindingOut.model_validate(row)


@router.delete("/{workspace_id}/channels/{channel_ref}/assets/{binding_id}", status_code=204)
async def remove_channel_asset(workspace_id: UUID, channel_ref: str, binding_id: UUID, _member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(404, "Channel not found")
    try:
        await service.detach_asset_binding(db, workspace_id, channel.id, binding_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))

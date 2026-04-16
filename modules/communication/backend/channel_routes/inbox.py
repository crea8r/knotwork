from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User
from libs.database import get_db
from libs.participants import list_workspace_participants, participant_kind

from .. import channels_service as service
from .. import notifications_service as notification_service
from ..channels_schemas import ChannelSubscriptionOut, ChannelSubscriptionUpdate, InboxItem, InboxStateUpdate, InboxSummary, ParticipantDeliveryPreferenceBundle, ParticipantDeliveryPreferenceOut, ParticipantDeliveryPreferenceUpdate
from .deps import caller_participant_id

router = APIRouter()


@router.get("/{workspace_id}/inbox", response_model=list[InboxItem])
async def get_inbox(workspace_id: UUID, archived: bool = Query(False), user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    rows = await service.inbox_items(db, workspace_id, caller_participant_id(user, member), archived=archived)
    return [InboxItem.model_validate(row) for row in rows]


@router.get("/{workspace_id}/inbox/summary", response_model=InboxSummary)
async def get_inbox_summary(workspace_id: UUID, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    return InboxSummary.model_validate(await service.inbox_summary(db, workspace_id, caller_participant_id(user, member)))


@router.post("/{workspace_id}/inbox/read-all", response_model=InboxSummary)
async def mark_inbox_read_all(workspace_id: UUID, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    participant_id = caller_participant_id(user, member)
    await notification_service.mark_all_app_deliveries_read(db, workspace_id=workspace_id, participant_id=participant_id)
    return InboxSummary.model_validate(await service.inbox_summary(db, workspace_id, participant_id))


@router.patch("/{workspace_id}/inbox/deliveries/{delivery_id}", response_model=InboxItem)
async def update_inbox_delivery_state(workspace_id: UUID, delivery_id: UUID, data: InboxStateUpdate, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    participant_id = caller_participant_id(user, member)
    delivery = await notification_service.update_delivery_state(db, workspace_id=workspace_id, participant_id=participant_id, delivery_id=delivery_id, read=data.read, archived=data.archived)
    if delivery is None:
        raise HTTPException(status_code=404, detail="Inbox delivery not found")
    row = await service.inbox_item_by_delivery_id(db, workspace_id=workspace_id, participant_id=participant_id, delivery_id=delivery.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Inbox item not found")
    return InboxItem.model_validate(row)


@router.get("/{workspace_id}/channels/subscriptions/me", response_model=list[ChannelSubscriptionOut])
async def get_my_channel_subscriptions(workspace_id: UUID, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    rows = await service.list_channel_subscriptions(db, workspace_id, caller_participant_id(user, member))
    return [ChannelSubscriptionOut(channel_id=row.channel_id, participant_id=row.participant_id, subscribed=row.unsubscribed_at is None, subscribed_at=row.subscribed_at, unsubscribed_at=row.unsubscribed_at) for row in rows]


@router.patch("/{workspace_id}/channels/{channel_ref}/subscription", response_model=ChannelSubscriptionOut)
async def update_my_channel_subscription(workspace_id: UUID, channel_ref: str, data: ChannelSubscriptionUpdate, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    channel = await service.get_channel(db, workspace_id, channel_ref)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    try:
        row = await service.set_channel_subscription(db, workspace_id, channel.id, caller_participant_id(user, member), subscribed=data.subscribed)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return ChannelSubscriptionOut(channel_id=row.channel_id, participant_id=row.participant_id, subscribed=row.unsubscribed_at is None, subscribed_at=row.subscribed_at, unsubscribed_at=row.unsubscribed_at)


@router.get("/{workspace_id}/participants/{participant_id}/delivery-preferences", response_model=ParticipantDeliveryPreferenceBundle)
async def get_participant_delivery_preferences(workspace_id: UUID, participant_id: str, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    current_participant_id = caller_participant_id(user, member)
    if member.role != "owner" and participant_id != current_participant_id:
        raise HTTPException(status_code=403, detail="Only owners can inspect other participants")
    participants = await list_workspace_participants(db, workspace_id)
    participant = next((row for row in participants if row["participant_id"] == participant_id), None)
    if participant is None:
        raise HTTPException(status_code=404, detail="Participant not found")
    prefs = await notification_service.get_or_build_participant_preferences(db, workspace_id, participant_id)
    return ParticipantDeliveryPreferenceBundle(participant_id=participant_id, kind=participant_kind(participant_id), display_name=str(participant.get("display_name") or participant_id), event_types=[ParticipantDeliveryPreferenceOut.model_validate(pref) for pref in prefs])


@router.patch("/{workspace_id}/participants/{participant_id}/delivery-preferences/{event_type}", response_model=ParticipantDeliveryPreferenceOut)
async def update_participant_delivery_preference(workspace_id: UUID, participant_id: str, event_type: str, data: ParticipantDeliveryPreferenceUpdate, user: User = Depends(get_current_user), member=Depends(get_workspace_member), db: AsyncSession = Depends(get_db)):
    current_participant_id = caller_participant_id(user, member)
    if member.role != "owner" and participant_id != current_participant_id:
        raise HTTPException(status_code=403, detail="Only owners can update other participants")
    pref = await notification_service.update_participant_preference(db, workspace_id=workspace_id, participant_id=participant_id, event_type=event_type, app_enabled=data.app_enabled, email_enabled=data.email_enabled, push_enabled=data.push_enabled, email_address=data.email_address)
    return ParticipantDeliveryPreferenceOut.model_validate(pref)

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from libs.auth.backend.models import User
from libs.participants import member_participant_id

from ..channels_models import Channel, ChannelSubscription


def caller_participant_id(user: User, member) -> str:
    return member_participant_id(member, user.id)


async def require_consultation_access(
    db: AsyncSession,
    workspace_id: UUID,
    channel: Channel,
    user: User,
    member,
) -> None:
    if channel.channel_type != "consultation":
        return
    participant_id = caller_participant_id(user, member)
    row = await db.execute(
        select(ChannelSubscription.id).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel.id,
            ChannelSubscription.participant_id == participant_id,
            ChannelSubscription.unsubscribed_at.is_(None),
        )
    )
    if row.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Channel not found")

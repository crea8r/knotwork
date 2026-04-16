from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from libs.participants import list_workspace_agent_participants, list_workspace_human_participants

from ..channels_models import Channel, ChannelSubscription
from .participants import ensure_default_channel_subscriptions


async def list_channel_participants(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> list[dict]:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.workspace_id != workspace_id or channel.archived_at is not None:
        raise ValueError("Channel not found")

    participants = await list_workspace_human_participants(db, workspace_id)
    participants.extend(await list_workspace_agent_participants(db, workspace_id))
    participants_by_id = {participant["participant_id"]: participant for participant in participants}

    rows = await db.execute(
        select(ChannelSubscription).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
        )
    )
    subscriptions = list(rows.scalars())
    if not subscriptions:
        return [_participant_row(channel_id, participant, subscribed=True, implicit=True) for participant in participants]

    out: list[dict] = []
    seen: set[str] = set()
    for subscription in subscriptions:
        participant = participants_by_id.get(subscription.participant_id)
        if participant is None:
            continue
        seen.add(subscription.participant_id)
        out.append(
            _participant_row(
                channel_id,
                participant,
                subscribed=subscription.unsubscribed_at is None,
                implicit=False,
                subscribed_at=subscription.subscribed_at,
                unsubscribed_at=subscription.unsubscribed_at,
            )
        )
    for participant in participants:
        if participant["participant_id"] not in seen:
            out.append(_participant_row(channel_id, participant, subscribed=False, implicit=False))
    out.sort(key=lambda row: (not row["subscribed"], str(row["display_name"]).lower()))
    return out


def _participant_row(
    channel_id: UUID,
    participant: dict,
    *,
    subscribed: bool,
    implicit: bool,
    subscribed_at: datetime | None = None,
    unsubscribed_at: datetime | None = None,
) -> dict:
    return {
        "channel_id": channel_id,
        "participant_id": participant["participant_id"],
        "display_name": participant["display_name"],
        "mention_handle": participant.get("mention_handle"),
        "kind": participant["kind"],
        "email": participant.get("email"),
        "avatar_url": participant.get("avatar_url"),
        "agent_zero_role": bool(participant.get("agent_zero_role")),
        "contribution_brief": participant.get("contribution_brief"),
        "availability_status": participant.get("availability_status") or "available",
        "capacity_level": participant.get("capacity_level") or "open",
        "status_note": participant.get("status_note"),
        "status_updated_at": participant.get("status_updated_at"),
        "subscribed": subscribed,
        "implicit": implicit,
        "subscribed_at": subscribed_at,
        "unsubscribed_at": unsubscribed_at,
    }


async def list_channel_subscriptions_for_channel(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
) -> list[ChannelSubscription]:
    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=channel_id)
    result = await db.execute(
        select(ChannelSubscription)
        .where(ChannelSubscription.workspace_id == workspace_id, ChannelSubscription.channel_id == channel_id)
        .order_by(ChannelSubscription.subscribed_at.asc())
    )
    return list(result.scalars())


async def set_channel_subscription(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    participant_id: str,
    *,
    subscribed: bool,
) -> ChannelSubscription:
    channel = await db.get(Channel, channel_id)
    if channel is None or channel.workspace_id != workspace_id:
        raise ValueError("Channel not found")
    if channel.channel_type == "run" and not subscribed:
        raise ValueError("Run chat participants cannot leave the channel")

    await ensure_default_channel_subscriptions(db, workspace_id, channel_id=channel_id)
    result = await db.execute(
        select(ChannelSubscription).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
            ChannelSubscription.participant_id == participant_id,
        )
    )
    row = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None:
        row = ChannelSubscription(
            workspace_id=workspace_id,
            channel_id=channel_id,
            participant_id=participant_id,
            unsubscribed_at=None if subscribed else now,
        )
        db.add(row)
    else:
        row.unsubscribed_at = None if subscribed else now
    await db.commit()
    await db.refresh(row)
    return row

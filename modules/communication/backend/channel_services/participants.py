from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from libs.participants import list_workspace_agent_participants, list_workspace_human_participants

from ..channels_models import Channel, ChannelSubscription


async def ensure_default_channel_subscriptions(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    channel_id: UUID | None = None,
) -> None:
    channel_query = select(Channel.id).where(Channel.workspace_id == workspace_id, Channel.archived_at.is_(None))
    if channel_id is not None:
        channel_query = channel_query.where(Channel.id == channel_id)
    channel_ids = [row[0] for row in (await db.execute(channel_query)).all()]
    if not channel_ids:
        return

    participants = await list_workspace_human_participants(db, workspace_id)
    participants.extend(await list_workspace_agent_participants(db, workspace_id))
    participant_ids = {participant["participant_id"] for participant in participants}
    if not participant_ids:
        return

    existing_rows = await db.execute(
        select(ChannelSubscription.channel_id, ChannelSubscription.participant_id).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id.in_(channel_ids),
        )
    )
    existing = {(row[0], row[1]) for row in existing_rows.all()}
    channels_with_explicit_rows = {row[0] for row in existing}

    created = False
    for target_channel_id in channel_ids:
        if target_channel_id in channels_with_explicit_rows:
            continue
        for participant_id in participant_ids:
            db.add(
                ChannelSubscription(
                    workspace_id=workspace_id,
                    channel_id=target_channel_id,
                    participant_id=participant_id,
                )
            )
            created = True

    if created:
        await db.commit()


async def sync_channel_participants(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    participant_ids: set[str],
) -> None:
    if not participant_ids:
        return

    rows = await db.execute(
        select(ChannelSubscription).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
        )
    )
    existing = {row.participant_id: row for row in rows.scalars()}
    now = datetime.now(timezone.utc)
    changed = False

    for participant_id, row in existing.items():
        if participant_id in participant_ids:
            if row.unsubscribed_at is not None:
                row.unsubscribed_at = None
                changed = True
        elif row.unsubscribed_at is None:
            row.unsubscribed_at = now
            changed = True

    for participant_id in participant_ids:
        if participant_id in existing:
            continue
        db.add(
            ChannelSubscription(
                workspace_id=workspace_id,
                channel_id=channel_id,
                participant_id=participant_id,
            )
        )
        changed = True

    if changed:
        await db.commit()


async def _active_channel_participant_ids(db: AsyncSession, workspace_id: UUID, channel_id: UUID) -> set[str]:
    rows = await db.execute(
        select(ChannelSubscription.participant_id, ChannelSubscription.unsubscribed_at).where(
            ChannelSubscription.workspace_id == workspace_id,
            ChannelSubscription.channel_id == channel_id,
        )
    )
    subscriptions = list(rows.all())
    if not subscriptions:
        participants = await list_workspace_human_participants(db, workspace_id)
        participants.extend(await list_workspace_agent_participants(db, workspace_id))
        return {participant["participant_id"] for participant in participants}
    return {participant_id for participant_id, unsubscribed_at in subscriptions if unsubscribed_at is None}


async def list_channel_subscriptions(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
) -> list[ChannelSubscription]:
    channel_rows = await db.execute(
        select(Channel.id).where(Channel.workspace_id == workspace_id, Channel.archived_at.is_(None))
    )
    channel_ids = [row[0] for row in channel_rows.all()]
    if not channel_ids:
        return []

    all_rows = await db.execute(
        select(ChannelSubscription)
        .where(ChannelSubscription.workspace_id == workspace_id, ChannelSubscription.channel_id.in_(channel_ids))
        .order_by(ChannelSubscription.subscribed_at.asc())
    )
    rows = list(all_rows.scalars())
    rows_by_channel: dict[UUID, list[ChannelSubscription]] = {}
    for row in rows:
        rows_by_channel.setdefault(row.channel_id, []).append(row)

    out: list[ChannelSubscription] = []
    for channel_id in channel_ids:
        channel_rows_for_id = rows_by_channel.get(channel_id, [])
        if not channel_rows_for_id:
            out.append(SimpleNamespace(channel_id=channel_id, participant_id=participant_id, unsubscribed_at=None, subscribed_at=None))
            continue
        matching = next((row for row in channel_rows_for_id if row.participant_id == participant_id), None)
        out.append(
            matching
            or SimpleNamespace(
                channel_id=channel_id,
                participant_id=participant_id,
                unsubscribed_at=datetime.now(timezone.utc),
                subscribed_at=None,
            )
        )
    return out

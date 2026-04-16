from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from core.api import channels as core_channels
from modules.communication.backend import channels_service
from modules.communication.backend.channels_models import ChannelMessage


def _find_message(messages: list[ChannelMessage], message_id: str | None) -> ChannelMessage | None:
    if message_id:
        for message in messages:
            if str(message.id) == message_id:
                return message
    return messages[-1] if messages else None


@dataclass
class LoadedChannelContext:
    channel: Any | None
    messages: list[ChannelMessage]
    participants: list[dict[str, Any]]
    assets: list[dict[str, Any]]
    trigger_message: ChannelMessage | None


async def load_channel_context(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    source_channel_id: str | None,
    trigger_message_id: str | None,
) -> LoadedChannelContext:
    channel = await core_channels.get_channel(db, workspace_id, source_channel_id) if source_channel_id else None
    messages = await channels_service.list_messages(db, workspace_id, channel.id) if channel is not None else []
    participants = await channels_service.list_channel_participants(db, workspace_id, channel.id) if channel is not None else []
    assets = await channels_service.list_channel_asset_bindings(db, workspace_id, channel.id) if channel is not None else []
    return LoadedChannelContext(
        channel=channel,
        messages=messages,
        participants=participants,
        assets=assets,
        trigger_message=_find_message(messages, trigger_message_id),
    )

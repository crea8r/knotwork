"""Core facade for channel APIs used across module boundaries."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from modules.communication.backend import channels_service
from modules.communication.backend.channels_schemas import ChannelMessageCreate


async def generate_channel_slug(db: AsyncSession, name: str) -> str:
    return await channels_service._generate_channel_slug(db, name)


async def ensure_default_workspace_channels(db: AsyncSession, workspace_id: UUID) -> None:
    await channels_service.ensure_workflow_channels(db, workspace_id)
    await channels_service.ensure_handbook_channel(db, workspace_id)
    await channels_service.ensure_bulletin_channel(db, workspace_id)
    await channels_service.ensure_default_channel_subscriptions(db, workspace_id)


async def list_channels(db: AsyncSession, workspace_id: UUID):
    return await channels_service.list_channels(db, workspace_id)


async def ensure_default_channel_subscriptions(db: AsyncSession, workspace_id: UUID) -> None:
    await channels_service.ensure_default_channel_subscriptions(db, workspace_id)


async def emit_asset_activity_message(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    asset_type: str,
    asset_id: str,
    content: str,
    metadata: dict[str, Any],
) -> None:
    await channels_service.emit_asset_activity_message(
        db,
        workspace_id=workspace_id,
        asset_type=asset_type,
        asset_id=asset_id,
        content=content,
        metadata=metadata,
    )


async def emit_run_status_event(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    run_id: str,
    graph_id: UUID,
    event_type: str,
    subtitle: str | None = None,
) -> None:
    await channels_service.emit_run_status_event(
        db,
        workspace_id=workspace_id,
        run_id=run_id,
        graph_id=graph_id,
        event_type=event_type,
        subtitle=subtitle,
    )


async def get_or_create_run_channel(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    run_id: str,
    graph_id: UUID | None,
    participant_ids: set[str] | list[str] | None,
):
    return await channels_service.get_or_create_run_channel(
        db,
        workspace_id=workspace_id,
        run_id=run_id,
        graph_id=graph_id,
        participant_ids=participant_ids,
    )


async def get_channel(db: AsyncSession, workspace_id: UUID, channel_ref: UUID | str):
    return await channels_service.get_channel(db, workspace_id, channel_ref)


async def create_channel(db: AsyncSession, workspace_id: UUID, data: Any):
    return await channels_service.create_channel(db, workspace_id, data)


async def create_message(db: AsyncSession, workspace_id: UUID, channel_id: UUID, data: Any):
    return await channels_service.create_message(db, workspace_id, channel_id, data)


async def post_message(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    channel_ref: UUID | str,
    content: str,
    author_name: str,
    run_id: str | None = None,
):
    channel = await get_channel(db, workspace_id, channel_ref)
    if channel is None:
        raise ValueError("Channel not found")
    return await channels_service.create_message(
        db,
        workspace_id,
        channel.id,
        ChannelMessageCreate(
            role="assistant",
            author_type="agent",
            author_name=author_name,
            content=content,
            run_id=run_id,
        ),
    )


async def create_decision(db: AsyncSession, workspace_id: UUID, channel_id: UUID, data: Any):
    return await channels_service.create_decision(db, workspace_id, channel_id, data)


async def respond_channel_message(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    channel_ref: UUID | str,
    message_id: str,
    current_user,
    member,
    resolution: str,
    guidance: str | None = None,
    override_output: dict | None = None,
    next_branch: str | None = None,
    answers: list[str] | None = None,
):
    from modules.communication.backend.channels_schemas import ChannelMessageRespondRequest
    from modules.workflows.backend.runs.human_review import respond_to_run_message

    return await respond_to_run_message(
        db,
        workspace_id=workspace_id,
        channel_ref=channel_ref,
        message_id=UUID(message_id),
        current_user=current_user,
        member=member,
        data=ChannelMessageRespondRequest(
            resolution=resolution,
            guidance=guidance,
            override_output=override_output,
            answers=answers,
            next_branch=next_branch,
        ),
    )


async def resolve_escalation_action(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    escalation_id: str,
    current_user,
    member,
    resolution: str,
    guidance: str | None = None,
    override_output: dict | None = None,
    next_branch: str | None = None,
    answers: list[str] | None = None,
    channel_id: str | None = None,
):
    from modules.workflows.backend.runs.human_review import build_resolution_payload, resolve_run_escalation

    payload = build_resolution_payload(
        current_user=current_user,
        member=member,
        resolution=resolution,
        guidance=guidance,
        override_output=override_output,
        next_branch=next_branch,
        answers=answers,
        channel_id=UUID(channel_id) if channel_id else None,
    )
    return await resolve_run_escalation(
        db,
        workspace_id=workspace_id,
        escalation_id=UUID(escalation_id),
        payload=payload,
    )


async def attach_asset_to_channel(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    *,
    asset_type: str,
    asset_id: str,
) -> None:
    await channels_service.attach_asset_to_channel(
        db,
        workspace_id,
        channel_id,
        asset_type=asset_type,
        asset_id=asset_id,
    )


async def list_bound_channel_ids_for_asset(
    db: AsyncSession,
    workspace_id: UUID,
    *,
    asset_type: str,
    asset_id: str,
) -> list[UUID]:
    return await channels_service.list_bound_channel_ids_for_asset(
        db,
        workspace_id,
        asset_type=asset_type,
        asset_id=asset_id,
    )


async def resolve_run_channel_id(
    db: AsyncSession,
    workspace_id: UUID,
    run_id: str,
    context: dict[str, Any],
) -> UUID | None:
    return await channels_service.resolve_run_channel_id(db, workspace_id, run_id, context)


async def find_workflow_channel_for_run(db: AsyncSession, run_id: str):
    return await channels_service.find_workflow_channel_for_run(db, run_id)


async def list_channel_subscriptions_for_channel(db: AsyncSession, workspace_id: UUID, channel_id: UUID):
    return await channels_service.list_channel_subscriptions_for_channel(db, workspace_id, channel_id)


async def publish_channel_event(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    channel_id: UUID,
    event_type: str,
    event_kind: str,
    source_type: str,
    source_id: str | None,
    actor_type: str,
    actor_name: str | None,
    payload: dict[str, Any],
    recipient_participant_ids: list[str] | None = None,
) -> None:
    await channels_service.publish_channel_event(
        db,
        workspace_id=workspace_id,
        channel_id=channel_id,
        event_type=event_type,
        event_kind=event_kind,
        source_type=source_type,
        source_id=source_id,
        actor_type=actor_type,
        actor_name=actor_name,
        payload=payload,
        recipient_participant_ids=recipient_participant_ids,
    )

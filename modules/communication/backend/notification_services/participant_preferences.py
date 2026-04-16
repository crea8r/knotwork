from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..notifications_models import ParticipantDeliveryPreference


SUPPORTED_EVENT_TYPES = (
    "escalation_created",
    "task_assigned",
    "mentioned_message",
    "run_failed",
    "run_completed",
    "message_posted",
)


async def get_participant_preference(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
    event_type: str,
) -> ParticipantDeliveryPreference | None:
    result = await db.execute(
        select(ParticipantDeliveryPreference).where(
            ParticipantDeliveryPreference.workspace_id == workspace_id,
            ParticipantDeliveryPreference.participant_id == participant_id,
            ParticipantDeliveryPreference.event_type == event_type,
        )
    )
    return result.scalar_one_or_none()


def default_preference_state(participant_id: str, event_type: str) -> dict[str, bool]:
    app_enabled = event_type in {"escalation_created", "mentioned_message", "message_posted", "run_failed", "run_completed", "task_assigned"}
    return {"app_enabled": app_enabled, "email_enabled": False, "push_enabled": event_type in SUPPORTED_EVENT_TYPES}


async def list_participant_preferences(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
) -> list[ParticipantDeliveryPreference]:
    result = await db.execute(
        select(ParticipantDeliveryPreference)
        .where(
            ParticipantDeliveryPreference.workspace_id == workspace_id,
            ParticipantDeliveryPreference.participant_id == participant_id,
        )
        .order_by(ParticipantDeliveryPreference.event_type.asc())
    )
    return list(result.scalars())


async def get_or_build_participant_preferences(db: AsyncSession, workspace_id: UUID, participant_id: str) -> list[dict]:
    existing = {pref.event_type: pref for pref in await list_participant_preferences(db, workspace_id, participant_id)}
    rows: list[dict] = []
    for event_type in SUPPORTED_EVENT_TYPES:
        pref = existing.get(event_type)
        defaults = default_preference_state(participant_id, event_type)
        rows.append(
            {
                "participant_id": participant_id,
                "event_type": event_type,
                "app_enabled": pref.app_enabled if pref else defaults["app_enabled"],
                "email_enabled": pref.email_enabled if pref else defaults["email_enabled"],
                "push_enabled": pref.push_enabled if pref else defaults["push_enabled"],
                "email_address": pref.email_address if pref else None,
            }
        )
    return rows


async def update_participant_preference(
    db: AsyncSession,
    workspace_id: UUID,
    participant_id: str,
    event_type: str,
    *,
    app_enabled: bool | None = None,
    email_enabled: bool | None = None,
    push_enabled: bool | None = None,
    email_address: str | None = None,
) -> ParticipantDeliveryPreference:
    pref = await get_participant_preference(db, workspace_id, participant_id, event_type)
    if pref is None:
        defaults = default_preference_state(participant_id, event_type)
        pref = ParticipantDeliveryPreference(
            workspace_id=workspace_id,
            participant_id=participant_id,
            event_type=event_type,
            app_enabled=defaults["app_enabled"],
            email_enabled=defaults["email_enabled"],
            push_enabled=defaults["push_enabled"],
        )
        db.add(pref)
        await db.flush()

    if app_enabled is not None:
        pref.app_enabled = app_enabled
    if email_enabled is not None:
        pref.email_enabled = email_enabled
    if push_enabled is not None:
        pref.push_enabled = push_enabled
    if email_address is not None:
        pref.email_address = email_address.strip() or None

    await db.commit()
    await db.refresh(pref)
    return pref

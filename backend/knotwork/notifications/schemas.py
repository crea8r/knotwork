from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class NotificationPreferenceResponse(BaseModel):
    id: UUID
    workspace_id: UUID
    email_enabled: bool
    email_address: str | None
    telegram_enabled: bool
    telegram_chat_id: str | None
    whatsapp_enabled: bool
    whatsapp_number: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class NotificationPreferenceUpdate(BaseModel):
    email_enabled: bool | None = None
    email_address: str | None = None
    telegram_enabled: bool | None = None
    telegram_chat_id: str | None = None
    whatsapp_enabled: bool | None = None
    whatsapp_number: str | None = None


class NotificationLogEntry(BaseModel):
    id: UUID
    workspace_id: UUID
    escalation_id: UUID | None
    channel: str
    status: str
    detail: str | None
    sent_at: datetime

    model_config = {"from_attributes": True}

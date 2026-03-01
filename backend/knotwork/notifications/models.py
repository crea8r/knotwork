from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from knotwork.database import Base


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False, unique=True
    )
    # Email
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_address: Mapped[str | None] = mapped_column(String, nullable=True)
    # Telegram
    telegram_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    telegram_chat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # WhatsApp (Phase 1: deep link only)
    whatsapp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    whatsapp_number: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False
    )
    escalation_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("escalations.id"), nullable=True
    )
    channel: Mapped[str] = mapped_column(String, nullable=False)
    # sent | failed | skipped
    status: Mapped[str] = mapped_column(String, nullable=False, default="sent")
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

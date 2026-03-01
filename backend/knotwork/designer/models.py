"""
Designer chat message persistence.

One conversation per graph_id, stored in the DB so history survives restarts.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from knotwork.database import Base


class DesignerChatMessage(Base):
    __tablename__ = "designer_chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    graph_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("graphs.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))   # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

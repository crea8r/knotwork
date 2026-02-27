from uuid import uuid4
from sqlalchemy import String, JSON, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from knotwork.database import Base


class Escalation(Base):
    __tablename__ = "escalations"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id"), nullable=False)
    run_node_state_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("run_node_states.id"), nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="open")
    context: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    assigned_to: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    timeout_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[str | None] = mapped_column(String, nullable=True)
    resolution_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

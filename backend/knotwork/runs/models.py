from uuid import uuid4
from sqlalchemy import String, Integer, Float, JSON, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from knotwork.database import Base


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    graph_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("graphs.id"), nullable=False)
    graph_version_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("graph_versions.id"), nullable=False)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    trigger: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    trigger_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    input: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    context_files: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    eta_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)


class RunNodeState(Base):
    __tablename__ = "run_node_states"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("runs.id"), nullable=False)
    node_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    input: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    knowledge_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    resolved_token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

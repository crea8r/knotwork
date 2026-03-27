from uuid import uuid4
from sqlalchemy import String, Integer, Float, JSON, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from knotwork.database import Base


class KnowledgeFolder(Base):
    """Explicit folder record — enables empty folders (Windows Explorer UX)."""
    __tablename__ = "knowledge_folders"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    project_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    path: Mapped[str] = mapped_column(String, nullable=False)  # e.g. "legal/compliance"
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class KnowledgeFile(Base):
    __tablename__ = "knowledge_files"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    project_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    path: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    raw_token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    resolved_token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    linked_paths: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    current_version_id: Mapped[str | None] = mapped_column(String, nullable=True)
    health_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    health_updated_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    access_policy: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # 'md' = editable markdown; 'pdf'/'docx'/'image'/'other' = binary view-only
    file_type: Mapped[str] = mapped_column(String, nullable=False, default="md")
    is_editable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class KnowledgeVersion(Base):
    __tablename__ = "knowledge_versions"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    file_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("knowledge_files.id"), nullable=False)
    storage_version_id: Mapped[str] = mapped_column(String, nullable=False)
    saved_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    change_summary: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class KnowledgeHealthLog(Base):
    __tablename__ = "knowledge_health_logs"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    file_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("knowledge_files.id"), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    token_score: Mapped[float] = mapped_column(Float, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False)
    escalation_score: Mapped[float] = mapped_column(Float, nullable=False)
    rating_score: Mapped[float] = mapped_column(Float, nullable=False)
    run_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    computed_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

from uuid import uuid4
from sqlalchemy import String, Text, JSON, DateTime, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from knotwork.database import Base


class Graph(Base):
    __tablename__ = "graphs"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="draft")
    default_model: Mapped[str | None] = mapped_column(String, nullable=True)
    trigger_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Production version pointer — null until first version is explicitly promoted
    production_version_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("graph_versions.id", use_alter=True, name="fk_graphs_production_version"),
        nullable=True,
    )
    # Public URL slug — null until explicitly set
    slug: Mapped[str | None] = mapped_column(String(200), nullable=True, unique=True)
    created_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class GraphVersion(Base):
    __tablename__ = "graph_versions"
    __table_args__ = (
        # Only one draft (version_id IS NULL) per (graph_id, parent_version_id) pair
        # enforced in service layer; DB uniqueness is only on non-null version_ids.
        UniqueConstraint("graph_id", "version_id", name="uq_graph_versions_graph_version"),
    )

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    graph_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("graphs.id"), nullable=False)
    definition: Mapped[dict] = mapped_column(JSON, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Versioning fields — null while record is a draft
    version_id: Mapped[str | None] = mapped_column(String(9), nullable=True)
    version_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    version_created_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Lineage: which version this draft/version was branched from (null for root draft)
    parent_version_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("graph_versions.id"), nullable=True
    )
    # Archival
    archived_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Whether the version's public page is enabled
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Tracks last edit time; frozen at promotion
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    created_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

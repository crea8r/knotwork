from uuid import uuid4
from sqlalchemy import String, Integer, Float, JSON, DateTime, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from libs.database import Base

from .runs_id import generate_run_id


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_run_id)
    workspace_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    project_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=True)
    objective_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("objectives.id"), nullable=True)
    graph_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("graphs.id"), nullable=False)
    graph_version_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("graph_versions.id"), nullable=True)
    # Draft run fields: populated when run is executed against a draft (not a named version)
    draft_definition: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    draft_snapshot_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="queued")
    trigger: Mapped[str] = mapped_column(String, nullable=False, default="manual")
    trigger_meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    input: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    context_files: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    eta_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)


class RunNodeState(Base):
    __tablename__ = "run_node_states"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id"), nullable=False)
    node_id: Mapped[str] = mapped_column(String, nullable=False)
    # S6.5: display name at time of run (denormalized so it survives graph edits)
    node_name: Mapped[str | None] = mapped_column(String, nullable=True)
    # S6.5: which agent system handled this node (currently "human" in this build)
    agent_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    input: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # S6.5: raw event stream [{ts, level, text, tool_name?, tool_args?, tool_result?}]
    agent_logs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # S6.5: routing decision emitted by agent or human
    next_branch: Mapped[str | None] = mapped_column(String, nullable=True)
    knowledge_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    resolved_token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RunWorklogEntry(Base):
    """Agent-written worklog — curated narration visible to operators in run detail."""
    __tablename__ = "run_worklog_entries"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    node_id: Mapped[str] = mapped_column(String, nullable=False)
    agent_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    # entry_type: 'observation' | 'tool_call' | 'decision' | 'proposal'
    entry_type: Mapped[str] = mapped_column(String, nullable=False, default="observation")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # tool call details, proposal path, etc.
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class RunHandbookProposal(Base):
    """Agent-proposed handbook change — requires human approval before writing."""
    __tablename__ = "run_handbook_proposals"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    node_id: Mapped[str] = mapped_column(String, nullable=False)
    agent_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    path: Mapped[str] = mapped_column(String, nullable=False)
    proposed_content: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    channel_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True)
    # status: 'pending' | 'approved' | 'rejected' | 'edited'
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    reviewed_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # what was actually saved (may differ from proposal after human editing)
    final_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ProviderCallLog(Base):
    """Per-call provider debug audit for run execution."""
    __tablename__ = "openai_call_logs"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("workspaces.id"), nullable=False)
    workflow_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("graphs.id"), nullable=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    run_node_state_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("run_node_states.id"), nullable=True)
    node_id: Mapped[str] = mapped_column(String, nullable=False)
    agent_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, default="openai")
    openai_assistant_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    openai_thread_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    openai_run_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    request_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    response_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="started")
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

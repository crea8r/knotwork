from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from knotwork.database import Base


class WorkspaceInvitation(Base):
    """Pending invitation for a user to join a workspace.

    The owner calls POST /workspaces/{id}/invitations → email with a magic link.
    The invitee clicks the link → POST /auth/invitations/{token}/accept → JWT issued.
    """
    __tablename__ = "workspace_invitations"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    workspace_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    invited_by_user_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    email: Mapped[str] = mapped_column(sa.String(320), nullable=False)
    role: Mapped[str] = mapped_column(sa.String(30), nullable=False, default="operator")
    # Secure random token sent in the invite email URL
    token: Mapped[str] = mapped_column(sa.String(120), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=func.now(), nullable=False
    )

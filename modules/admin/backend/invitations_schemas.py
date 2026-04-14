from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class CreateInvitationRequest(BaseModel):
    email: EmailStr
    role: str = Field(default="operator", pattern="^(owner|operator)$")


class InvitationOut(BaseModel):
    id: UUID
    workspace_id: UUID
    email: str
    role: str
    expires_at: datetime
    accepted_at: datetime | None = None
    created_at: datetime

    # Masked token hint so the UI can show "invite pending for ..." without exposing the full token
    token_hint: str  # last 6 chars


class InvitationVerifyOut(BaseModel):
    """Returned by GET /auth/invitations/{token} — enough info to render the accept UI."""
    email: str
    workspace_name: str
    role: str
    expires_at: datetime
    already_accepted: bool


class AcceptInvitationRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    password: str = Field(..., min_length=4, max_length=200)


class AcceptInvitationOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: UUID
    workspace_id: UUID
    name: str
    email: str
    role: str

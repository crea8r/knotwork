from __future__ import annotations

from pydantic import BaseModel, Field

from ..runs.schemas import RunAttachmentRef


class VersionPublishRequest(BaseModel):
    description_md: str = Field(..., min_length=1, max_length=1000)


class PublicWorkflowViewOut(BaseModel):
    description_md: str
    input_schema: list[dict]
    rate_limit_max_requests: int
    rate_limit_window_seconds: int
    # Resolved version slug — useful when accessing via the graph-level URL
    resolved_version_slug: str
    notice_test_only: bool = True
    notice_future_paid: bool = True


class PublicRunTriggerRequest(BaseModel):
    input: dict = {}
    email: str | None = Field(default=None, max_length=320)
    context_files: list[RunAttachmentRef] = []


class PublicRunTriggerOut(BaseModel):
    run_id: str
    run_token: str
    run_public_url: str


class PublicRunViewOut(BaseModel):
    description_md: str
    input: dict
    final_output: str | None = None
    status: str
    email_subscribed: bool = False


class PublicRunNotifyRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)


class PublicRunNotifyOut(BaseModel):
    ok: bool = True

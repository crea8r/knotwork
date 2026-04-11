from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class KnowledgeFileCreate(BaseModel):
    path: str
    title: str | None = None
    content: str = ""
    file_type: str = "md"
    change_summary: str | None = None


class KnowledgeFileUpdate(BaseModel):
    content: str
    change_summary: str | None = None


class KnowledgeFileOut(BaseModel):
    id: UUID
    workspace_id: UUID
    path: str
    title: str
    raw_token_count: int
    resolved_token_count: int
    linked_paths: list[str]
    current_version_id: str | None
    health_score: float | None
    health_updated_at: datetime | None
    file_type: str
    is_editable: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class KnowledgeFileWithContent(KnowledgeFileOut):
    content: str
    version_id: str


class FileVersionOut(BaseModel):
    version_id: str
    saved_at: str
    saved_by: str
    change_summary: str | None


class KnowledgeRestoreRequest(BaseModel):
    version_id: str
    restored_by: str = "system"


class SuggestionOut(BaseModel):
    suggestions: list[str]
    health_score: float | None


# ── Folder schemas ────────────────────────────────────────────────────────────

class KnowledgeFolderOut(BaseModel):
    id: UUID
    workspace_id: UUID
    path: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CreateFolderRequest(BaseModel):
    path: str  # e.g. "legal/compliance"


class RenameFolderRequest(BaseModel):
    new_path: str  # full new path e.g. "legal/archive"


# ── File operation schemas ────────────────────────────────────────────────────

class RenameFileRequest(BaseModel):
    new_path: str  # full new path e.g. "legal/renamed.md"

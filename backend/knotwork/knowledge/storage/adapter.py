"""
Storage adapter abstraction for knowledge files.

RULE: Never access filesystem or S3 directly anywhere in the codebase.
      Always use the injected StorageAdapter instance.

To get the active adapter: from knotwork.knowledge.storage import get_storage_adapter
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class FileVersion:
    version_id: str
    saved_at: str       # ISO 8601
    saved_by: str       # user ID or "agent:<agent_id>"
    change_summary: str | None


@dataclass
class FileContent:
    content: str
    version_id: str
    path: str


class StorageAdapter(ABC):
    """
    Abstract interface for knowledge file storage.
    Implementations: LocalFSAdapter, S3Adapter.

    Text files (markdown, agent views): read/write/delete/history.
    Binary files (PDF, DOCX, images): write_raw/read_raw.
    Binary is stored separately from text; list() never returns raw paths.
    """

    @abstractmethod
    async def read(self, workspace_id: str, path: str) -> FileContent:
        """Read current version. Raises FileNotFoundError if missing/deleted."""

    @abstractmethod
    async def read_version(self, workspace_id: str, path: str, version_id: str) -> FileContent:
        """Read a specific historical version."""

    @abstractmethod
    async def write(
        self, workspace_id: str, path: str, content: str,
        saved_by: str, change_summary: str | None = None,
    ) -> str:
        """Write (create or update). Returns new version_id. Never deletes old versions."""

    @abstractmethod
    async def delete(self, workspace_id: str, path: str) -> None:
        """Soft-delete. Versions are retained for audit."""

    @abstractmethod
    async def list(self, workspace_id: str, folder: str = "") -> list[str]:
        """
        List all file paths under folder (recursive).
        Returns relative paths from workspace root e.g. ["legal/guide.md"].
        Never returns internal paths (._raw/, ._sys/).
        """

    @abstractmethod
    async def history(self, workspace_id: str, path: str) -> list[FileVersion]:
        """Return version history newest first."""

    @abstractmethod
    async def restore(self, workspace_id: str, path: str, version_id: str, restored_by: str) -> str:
        """Restore to a previous version. Returns new version_id."""

    @abstractmethod
    async def exists(self, workspace_id: str, path: str) -> bool:
        """True if path exists and is not deleted."""

    @abstractmethod
    async def move(self, workspace_id: str, old_path: str, new_path: str, moved_by: str) -> str:
        """
        Move/rename a file. Copies content + history to new_path, soft-deletes old_path.
        Returns new version_id at new_path.
        Also moves raw binary if it exists.
        """

    @abstractmethod
    async def write_raw(self, workspace_id: str, path: str, content_bytes: bytes) -> None:
        """Store binary bytes (PDF, DOCX, image) for a given logical path."""

    @abstractmethod
    async def read_raw(self, workspace_id: str, path: str) -> bytes:
        """Read binary bytes for a given logical path. Raises FileNotFoundError."""

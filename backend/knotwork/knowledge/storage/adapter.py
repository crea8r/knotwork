"""
Storage adapter abstraction for knowledge files.

RULE: Never access filesystem or S3 directly anywhere in the codebase.
      Always use the injected StorageAdapter instance.

To get the active adapter: from knotwork.knowledge.storage import get_storage_adapter
"""

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
    """

    @abstractmethod
    async def read(self, workspace_id: str, path: str) -> FileContent:
        """
        Read a file. Returns current version.
        Raises FileNotFoundError if path does not exist.
        """

    @abstractmethod
    async def read_version(
        self, workspace_id: str, path: str, version_id: str
    ) -> FileContent:
        """Read a specific historical version of a file."""

    @abstractmethod
    async def write(
        self,
        workspace_id: str,
        path: str,
        content: str,
        saved_by: str,
        change_summary: str | None = None,
    ) -> str:
        """
        Write (create or update) a file. Returns the new version_id.
        Every write creates a new version — old versions are never deleted.
        """

    @abstractmethod
    async def delete(self, workspace_id: str, path: str) -> None:
        """Soft-delete a file. Versions are retained for audit purposes."""

    @abstractmethod
    async def list(self, workspace_id: str, folder: str = "") -> list[str]:
        """
        List all file paths under a folder (recursive).
        Returns relative paths from workspace root, e.g. ["legal/guide.md"].
        """

    @abstractmethod
    async def history(self, workspace_id: str, path: str) -> list[FileVersion]:
        """Return version history for a file, newest first."""

    @abstractmethod
    async def restore(
        self, workspace_id: str, path: str, version_id: str, restored_by: str
    ) -> str:
        """
        Restore a file to a previous version.
        Creates a new version (does not overwrite history).
        Returns the new version_id.
        """

    @abstractmethod
    async def exists(self, workspace_id: str, path: str) -> bool:
        """Return True if the path exists and is not deleted."""

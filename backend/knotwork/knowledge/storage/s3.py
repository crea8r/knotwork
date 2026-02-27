"""
S3Adapter: Amazon S3-backed storage adapter for production deployments.

S3 key format: {workspace_id}/{path}
Version history is managed via native S3 Object Versioning — the bucket must
have versioning enabled. The version_id returned/accepted by all methods maps
directly to S3 VersionId values.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import aioboto3

from knotwork.knowledge.storage.adapter import (
    FileContent,
    FileVersion,
    StorageAdapter,
)

if TYPE_CHECKING:
    from types_aiobotocore_s3.client import S3Client


class S3Adapter(StorageAdapter):
    """
    Storage adapter backed by Amazon S3 with native object versioning.

    Requires the target bucket to have S3 Object Versioning enabled.
    Credentials are resolved via the standard boto3 credential chain
    (environment variables, ~/.aws/credentials, IAM role, etc.).
    """

    def __init__(self, bucket: str, region: str | None = None) -> None:
        """
        Initialise the adapter.

        Args:
            bucket: Name of the S3 bucket to read from and write to.
            region: AWS region override. Defaults to the environment/config default.
        """
        self.bucket = bucket
        self.region = region
        self._session = aioboto3.Session()

    async def read(self, workspace_id: str, path: str) -> FileContent:
        """Fetch the current (latest) version of an S3 object."""
        raise NotImplementedError

    async def read_version(
        self, workspace_id: str, path: str, version_id: str
    ) -> FileContent:
        """Fetch a specific S3 object version using the native VersionId."""
        raise NotImplementedError

    async def write(
        self,
        workspace_id: str,
        path: str,
        content: str,
        saved_by: str,
        change_summary: str | None = None,
    ) -> str:
        """
        Upload content to S3 and return the new S3 VersionId.

        Metadata tags ``saved_by`` and ``change_summary`` are stored as S3
        object metadata so they can be retrieved from the version history.
        """
        raise NotImplementedError

    async def delete(self, workspace_id: str, path: str) -> None:
        """Insert a delete marker into S3, preserving all prior versions."""
        raise NotImplementedError

    async def list(self, workspace_id: str, folder: str = "") -> list[str]:
        """List all non-deleted object keys under the workspace prefix."""
        raise NotImplementedError

    async def history(self, workspace_id: str, path: str) -> list[FileVersion]:
        """Return the S3 version list for a key, mapped to FileVersion objects."""
        raise NotImplementedError

    async def restore(
        self, workspace_id: str, path: str, version_id: str, restored_by: str
    ) -> str:
        """Copy a previous S3 version to create a new current version."""
        raise NotImplementedError

    async def exists(self, workspace_id: str, path: str) -> bool:
        """Return True when the object exists in S3 without a delete marker."""
        raise NotImplementedError

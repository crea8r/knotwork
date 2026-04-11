"""
Storage adapter registry.
Import get_storage_adapter() to get the active adapter instance.
"""

from functools import lru_cache

from libs.config import StorageBackend, settings

from .adapter import StorageAdapter


@lru_cache(maxsize=1)
def get_storage_adapter() -> StorageAdapter:
    """
    Returns the active StorageAdapter based on STORAGE_ADAPTER env var.
    Cached — same instance reused across the process lifetime.
    """
    if settings.storage_adapter == StorageBackend.S3:
        from .s3 import S3Adapter
        return S3Adapter(bucket=settings.s3_bucket, region=settings.s3_region)

    from .local_fs import LocalFSAdapter
    return LocalFSAdapter(root=settings.local_fs_root)


__all__ = ["StorageAdapter", "get_storage_adapter"]

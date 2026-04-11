"""
LocalFSAdapter: filesystem-backed storage for development.

Layout:
  {root}/{workspace_id}/{path}             — current text content (md or agent view)
  {root}/{workspace_id}/{path}.meta.json   — {"deleted": bool, "versions": [...]}
  {root}/{workspace_id}/._raw/{path}       — binary files (PDF, DOCX, images)
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiofiles

from .adapter import FileContent, FileVersion, StorageAdapter

_INTERNAL_PREFIXES = ("._raw/", "._raw\\")


class LocalFSAdapter(StorageAdapter):
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def _file_path(self, workspace_id: str, path: str) -> Path:
        return self.root / workspace_id / path

    def _meta_path(self, workspace_id: str, path: str) -> Path:
        return self.root / workspace_id / (path + ".meta.json")

    def _raw_path(self, workspace_id: str, path: str) -> Path:
        return self.root / workspace_id / "._raw" / path

    async def _read_meta(self, workspace_id: str, path: str) -> dict:
        try:
            async with aiofiles.open(self._meta_path(workspace_id, path)) as f:
                return json.loads(await f.read())
        except FileNotFoundError:
            return {"deleted": False, "versions": []}

    async def _write_meta(self, workspace_id: str, path: str, meta: dict) -> None:
        mp = self._meta_path(workspace_id, path)
        mp.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(mp, "w") as f:
            await f.write(json.dumps(meta, indent=2))

    async def read(self, workspace_id: str, path: str) -> FileContent:
        meta = await self._read_meta(workspace_id, path)
        if meta.get("deleted"):
            raise FileNotFoundError(path)
        fp = self._file_path(workspace_id, path)
        try:
            async with aiofiles.open(fp) as f:
                content = await f.read()
        except FileNotFoundError:
            raise FileNotFoundError(path)
        version_id = meta["versions"][0]["version_id"] if meta["versions"] else "unversioned"
        return FileContent(content=content, version_id=version_id, path=path)

    async def read_version(self, workspace_id: str, path: str, version_id: str) -> FileContent:
        meta = await self._read_meta(workspace_id, path)
        entry = next((v for v in meta["versions"] if v["version_id"] == version_id), None)
        if not entry:
            raise FileNotFoundError(f"{path}@{version_id}")
        return FileContent(content=entry.get("content", ""), version_id=version_id, path=path)

    async def write(
        self, workspace_id: str, path: str, content: str,
        saved_by: str, change_summary: str | None = None,
    ) -> str:
        fp = self._file_path(workspace_id, path)
        fp.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(fp, "w") as f:
            await f.write(content)
        version_id = str(uuid.uuid4())
        meta = await self._read_meta(workspace_id, path)
        meta["deleted"] = False
        meta["versions"].insert(0, {
            "version_id": version_id,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "saved_by": saved_by,
            "change_summary": change_summary,
            "content": content,
        })
        await self._write_meta(workspace_id, path, meta)
        return version_id

    async def delete(self, workspace_id: str, path: str) -> None:
        meta = await self._read_meta(workspace_id, path)
        meta["deleted"] = True
        await self._write_meta(workspace_id, path, meta)

    async def list(self, workspace_id: str, folder: str = "") -> list[str]:
        base = self.root / workspace_id / folder if folder else self.root / workspace_id
        if not base.exists():
            return []
        result = []
        for p in base.rglob("*"):
            if p.is_dir():
                continue
            rel = str(p.relative_to(self.root / workspace_id)).replace("\\", "/")
            # Skip internal dirs and meta sidecars
            if any(rel.startswith(pfx) for pfx in ("._raw/", "._sys/")):
                continue
            if rel.endswith(".meta.json"):
                continue
            meta = await self._read_meta(workspace_id, rel)
            if not meta.get("deleted"):
                result.append(rel)
        return sorted(result)

    async def history(self, workspace_id: str, path: str) -> list[FileVersion]:
        meta = await self._read_meta(workspace_id, path)
        return [
            FileVersion(
                version_id=v["version_id"],
                saved_at=v["saved_at"],
                saved_by=v["saved_by"],
                change_summary=v.get("change_summary"),
            )
            for v in meta["versions"]
        ]

    async def restore(self, workspace_id: str, path: str, version_id: str, restored_by: str) -> str:
        meta = await self._read_meta(workspace_id, path)
        entry = next((v for v in meta["versions"] if v["version_id"] == version_id), None)
        if not entry:
            raise FileNotFoundError(f"{path}@{version_id}")
        return await self.write(
            workspace_id, path, entry.get("content", ""),
            restored_by, change_summary=f"Restored from {version_id}",
        )

    async def exists(self, workspace_id: str, path: str) -> bool:
        meta = await self._read_meta(workspace_id, path)
        return not meta.get("deleted") and self._file_path(workspace_id, path).exists()

    async def move(self, workspace_id: str, old_path: str, new_path: str, moved_by: str) -> str:
        """Copy content to new_path, soft-delete old_path, move raw binary if present."""
        try:
            fc = await self.read(workspace_id, old_path)
            content = fc.content
        except FileNotFoundError:
            content = ""
        new_version_id = await self.write(
            workspace_id, new_path, content, moved_by, change_summary=f"Moved from {old_path}"
        )
        await self.delete(workspace_id, old_path)
        # Move raw binary if exists
        raw_old = self._raw_path(workspace_id, old_path)
        if raw_old.exists():
            raw_new = self._raw_path(workspace_id, new_path)
            raw_new.parent.mkdir(parents=True, exist_ok=True)
            raw_old.rename(raw_new)
        return new_version_id

    async def write_raw(self, workspace_id: str, path: str, content_bytes: bytes) -> None:
        """Store binary bytes under ._raw/ subdirectory."""
        rp = self._raw_path(workspace_id, path)
        rp.parent.mkdir(parents=True, exist_ok=True)
        async with aiofiles.open(rp, "wb") as f:
            await f.write(content_bytes)

    async def read_raw(self, workspace_id: str, path: str) -> bytes:
        """Read binary bytes. Raises FileNotFoundError if not stored as raw."""
        rp = self._raw_path(workspace_id, path)
        try:
            async with aiofiles.open(rp, "rb") as f:
                return await f.read()
        except FileNotFoundError:
            raise FileNotFoundError(f"No raw binary for {path}")

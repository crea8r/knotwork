"""
Upload and binary file endpoints.

POST /workspaces/{id}/handbook/upload         — convert file → MD preview (unchanged)
POST /workspaces/{id}/handbook/upload-raw     — store binary file as view-only
GET  /workspaces/{id}/knowledge/file/raw      — serve binary for download/view
GET  /workspaces/{id}/knowledge/file/html     — DOCX → HTML for browser display
"""
from __future__ import annotations

import mimetypes
from pathlib import Path as _Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.knowledge import service as svc
from knotwork.knowledge.storage import get_storage_adapter

router = APIRouter(prefix="/workspaces", tags=["knowledge-upload"])

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tiff"}
_VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v", ".3gp"}


@router.post("/{workspace_id}/handbook/upload")
async def upload_handbook_file(
    workspace_id: UUID,
    file: UploadFile = File(...),
    folder: str = Query(default=""),
):
    """Convert uploaded file → Markdown preview. No file is saved yet."""
    from knotwork.knowledge.conversion import VIDEO_EXTS, suggested_path
    from knotwork.knowledge.conversion_vision import convert_with_vision

    MAX_BYTES = 10 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(400, "File is too large (max 10 MB)")

    filename = file.filename or "upload.txt"
    suffix = _Path(filename).suffix.lower()

    if suffix in VIDEO_EXTS:
        raise HTTPException(400, {
            "error": "video_not_supported",
            "message": "Video files aren't supported yet — we're working on it!",
        })

    try:
        markdown, fmt = await convert_with_vision(filename, content)
    except (ValueError, Exception) as exc:
        raise HTTPException(422, f"Conversion failed: {exc}")

    path = suggested_path(filename, folder)
    title = _Path(filename).stem.replace("-", " ").replace("_", " ").title()

    return {
        "suggested_path": path,
        "suggested_title": title,
        "converted_content": markdown,
        "format": fmt,
        "original_filename": filename,
        "raw_bytes_b64": None,  # placeholder for future use
    }


@router.post("/{workspace_id}/handbook/upload-raw", status_code=201)
async def upload_raw_file(
    workspace_id: UUID,
    file: UploadFile = File(...),
    folder: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
):
    """Store file as view-only binary. Extracts agent MD silently."""
    from knotwork.knowledge.conversion import suggested_path
    from knotwork.knowledge.conversion_vision import convert_with_vision

    MAX_BYTES = 10 * 1024 * 1024
    raw_bytes = await file.read()
    if len(raw_bytes) > MAX_BYTES:
        raise HTTPException(400, "File too large (max 10 MB)")

    filename = file.filename or "upload.bin"
    suffix = _Path(filename).suffix.lower()

    if suffix in _VIDEO_EXTS:
        raise HTTPException(400, "Video files are not supported")

    # Classify file type
    if suffix == ".pdf":
        file_type = "pdf"
    elif suffix in (".doc", ".docx"):
        file_type = "docx"
    elif suffix in _IMAGE_EXTS:
        file_type = "image"
    else:
        file_type = "other"

    # Silently extract agent MD (best effort)
    try:
        agent_md, _ = await convert_with_vision(filename, raw_bytes)
    except Exception:
        agent_md = f"# {_Path(filename).stem}\n\n*Binary file — content not available as text.*\n"

    path = suggested_path(filename, folder)
    title = _Path(filename).stem.replace("-", " ").replace("_", " ").title()

    kf = await svc.store_raw_file(
        db, workspace_id, path, title, raw_bytes, file_type, agent_md, created_by="system",
    )
    from knotwork.knowledge.schemas import KnowledgeFileOut
    return KnowledgeFileOut.model_validate(kf)


@router.get("/{workspace_id}/knowledge/file/raw")
async def get_raw_file(
    workspace_id: UUID,
    path: str = Query(...),
    download: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    """Serve raw binary bytes for PDF/image/DOCX viewing or download."""
    kf = await svc.get_file_by_path(db, workspace_id, path)
    if kf is None:
        raise HTTPException(404, "File not found")

    adapter = get_storage_adapter()
    try:
        raw = await adapter.read_raw(str(workspace_id), path)
    except FileNotFoundError:
        raise HTTPException(404, "Raw binary not found")

    suffix = _Path(path).suffix.lower()
    mime = mimetypes.types_map.get(suffix, "application/octet-stream")
    filename = _Path(path).name

    disposition = f'attachment; filename="{filename}"' if download else f'inline; filename="{filename}"'
    return Response(
        content=raw,
        media_type=mime,
        headers={"Content-Disposition": disposition},
    )


@router.get("/{workspace_id}/knowledge/file/html", response_class=HTMLResponse)
async def get_docx_as_html(
    workspace_id: UUID,
    path: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Convert DOCX to HTML using mammoth for browser display."""
    try:
        import mammoth
    except ImportError:
        raise HTTPException(503, "mammoth not installed — DOCX rendering unavailable")

    kf = await svc.get_file_by_path(db, workspace_id, path)
    if kf is None or kf.file_type != "docx":
        raise HTTPException(404, "DOCX file not found")

    adapter = get_storage_adapter()
    try:
        raw = await adapter.read_raw(str(workspace_id), path)
    except FileNotFoundError:
        raise HTTPException(404, "Raw DOCX not found")

    import io
    result = mammoth.convert_to_html(io.BytesIO(raw))
    html_body = result.value
    return f"""<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>body{{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6}}
h1,h2,h3{{margin-top:1.5em}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ddd;padding:8px}}th{{background:#f5f5f5}}</style>
</head><body>{html_body}</body></html>"""

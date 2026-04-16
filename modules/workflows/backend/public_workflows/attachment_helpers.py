"""Shared helpers for public workflow attachment upload/serve routes."""
from __future__ import annotations

import hashlib
import hmac
from pathlib import Path

from libs.config import settings

MAX_RUN_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024


def safe_filename(name: str) -> str:
    cleaned = Path(name or "attachment").name
    return cleaned or "attachment"


def build_attachment_key(workspace_id: object, attachment_id: str, filename: str) -> str:
    return f"runs/{workspace_id}/{attachment_id}/{filename}"


def build_download_token(workspace_id: object, key: str) -> str:
    msg = f"{workspace_id}:{key}".encode("utf-8")
    return hmac.new(settings.jwt_secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()

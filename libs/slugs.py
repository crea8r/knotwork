from __future__ import annotations

import re
import secrets
import string
from uuid import UUID


_RANDOM_ALPHABET = string.ascii_lowercase + string.digits


def slugify_text(value: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower().strip()).strip("-")
    return (slug[:72] or fallback).strip("-")


def make_slug_candidate(value: str, fallback: str) -> str:
    base = slugify_text(value, fallback)
    suffix = "".join(secrets.choice(_RANDOM_ALPHABET) for _ in range(4))
    return f"{base}-{suffix}"


def parse_uuid_ref(value: str) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None

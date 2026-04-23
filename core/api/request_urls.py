from __future__ import annotations

from fastapi import Request

from libs.config import settings


def _first_forwarded_value(value: str | None) -> str | None:
    if value is None:
        return None
    first = value.split(",", 1)[0].strip()
    return first or None


def resolve_backend_base_url(request: Request | None = None) -> str:
    """
    Resolve the backend base URL as seen by the current caller.

    This keeps agent discovery usable in local Docker dev where the caller may
    reach Knotwork through `host.docker.internal` or a compose network alias
    even while the backend's canonical host-facing URL is still localhost.
    """
    if request is None:
        return settings.normalized_backend_url

    forwarded_host = _first_forwarded_value(request.headers.get("x-forwarded-host"))
    if forwarded_host:
        forwarded_proto = _first_forwarded_value(request.headers.get("x-forwarded-proto"))
        scheme = forwarded_proto or request.url.scheme
        return f"{scheme}://{forwarded_host}".rstrip("/")

    return str(request.base_url).rstrip("/")

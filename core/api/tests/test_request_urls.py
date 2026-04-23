from __future__ import annotations

from fastapi import Request

from core.api.request_urls import resolve_backend_base_url


def _request(*, host: str, scheme: str = "http", forwarded_host: str | None = None, forwarded_proto: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = [(b"host", host.encode("utf-8"))]
    if forwarded_host is not None:
        headers.append((b"x-forwarded-host", forwarded_host.encode("utf-8")))
    if forwarded_proto is not None:
        headers.append((b"x-forwarded-proto", forwarded_proto.encode("utf-8")))
    return Request(
        {
            "type": "http",
            "scheme": scheme,
            "method": "GET",
            "path": "/api/v1/workspaces/ws/.well-known/agent",
            "query_string": b"",
            "headers": headers,
            "client": ("testclient", 123),
            "server": ("testserver", 80),
        }
    )


def test_resolve_backend_base_url_uses_request_host_for_docker_reachable_discovery():
    request = _request(host="host.docker.internal:8000")

    assert resolve_backend_base_url(request) == "http://host.docker.internal:8000"


def test_resolve_backend_base_url_prefers_forwarded_headers():
    request = _request(
        host="backend-dev:8000",
        forwarded_host="agent.example.test",
        forwarded_proto="https",
    )

    assert resolve_backend_base_url(request) == "https://agent.example.test"

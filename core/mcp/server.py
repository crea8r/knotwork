from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlparse

import httpx
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from libs.auth.backend.service import decode_access_token
from libs.config import settings
from core.mcp.module_registry import register_enabled_module_mcp_tools
from core.mcp.runtime import KnotworkMCPRuntime


class KnotworkAPIError(RuntimeError):
    pass


class KnotworkAPIClient:
    def __init__(
        self,
        *,
        api_url: str,
        bearer_token: str,
        workspace_id: str,
        timeout_seconds: float = 30.0,
    ):
        self.api_url = api_url.rstrip("/")
        self.bearer_token = bearer_token
        self.workspace_id = workspace_id
        self.timeout_seconds = timeout_seconds

    def workspace_path(self, suffix: str) -> str:
        suffix = suffix if suffix.startswith("/") else f"/{suffix}"
        return f"/api/v1/workspaces/{self.workspace_id}{suffix}"

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self.api_url}{path}"
        timeout = httpx.Timeout(self.timeout_seconds)
        headers = {
            "Authorization": f"Bearer {self.bearer_token}",
            "Accept": "application/json",
        }
        if json_body is not None:
            headers["Content-Type"] = "application/json"

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method=method.upper(),
                url=url,
                params=params,
                json=json_body,
                headers=headers,
            )

        if response.status_code >= 400:
            detail = self._extract_error_detail(response)
            raise KnotworkAPIError(
                f"{method.upper()} {path} failed with {response.status_code}: {detail}"
            )

        if response.status_code == 204 or not response.content:
            return {"ok": True}

        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        return {"text": response.text}

    @staticmethod
    def _extract_error_detail(response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            return response.text.strip() or response.reason_phrase

        if isinstance(payload, dict):
            detail = payload.get("detail")
            if detail is not None:
                return str(detail)
        return str(payload)


class KnotworkTokenVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        claims = decode_access_token(token)
        if claims is None:
            return None
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            return None
        exp = claims.get("exp")
        expires_at = int(exp) if isinstance(exp, (int, float)) else None
        return AccessToken(
            token=token,
            client_id=subject,
            scopes=[],
            expires_at=expires_at,
            resource=f"{settings.normalized_backend_url}/mcp",
        )


def _json_text(payload: Any) -> str:
    return json.dumps(payload, indent=2, sort_keys=True)


def _mcp_transport_security_settings() -> TransportSecuritySettings:
    backend = urlparse(settings.normalized_backend_url)
    frontend = urlparse(settings.normalized_frontend_url)
    allowed_hosts = {
        "127.0.0.1:*",
        "localhost:*",
        "[::1]:*",
        # OpenClaw commonly runs in Docker and reaches the host backend through
        # these names while local Knotwork advertises localhost externally.
        "host.docker.internal:*",
        "knotwork-local-backend-dev-1:*",
    }
    allowed_origins = {
        "http://127.0.0.1:*",
        "http://localhost:*",
        "http://[::1]:*",
        "http://host.docker.internal:*",
        "http://knotwork-local-backend-dev-1:*",
    }

    for parsed in (backend, frontend):
        if parsed.netloc:
            allowed_hosts.add(parsed.netloc)
            allowed_origins.add(f"{parsed.scheme}://{parsed.netloc}")

    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=sorted(allowed_hosts),
        allowed_origins=sorted(allowed_origins),
    )


def build_server(client: KnotworkAPIClient | None = None) -> FastMCP:

    mcp = FastMCP(
        name="Knotwork",
        instructions=(
            "Operate a Knotwork workspace through its HTTP API. "
            "Use read tools and resources first for context, then mutate state through the "
            "domain tools for runs, escalations, objectives, channels, inbox, knowledge, "
            "notifications, and workspace members. Read member contribution briefs and status "
            "signals before routing objective work or deciding who to consult. Keep your own "
            "member status current when your availability or active commitments change."
        ),
        streamable_http_path="/",
        json_response=True,
        auth=AuthSettings(
            issuer_url=settings.normalized_backend_url,
            resource_server_url=f"{settings.normalized_backend_url}/mcp",
            required_scopes=[],
        ),
        token_verifier=KnotworkTokenVerifier(),
        transport_security=_mcp_transport_security_settings(),
    )

    def _client_from_context(ctx: Context | None) -> KnotworkAPIClient:
        if client is not None:
            return client
        if ctx is None or ctx.request_context.request is None:
            raise KnotworkAPIError("Missing MCP request context")
        access_token = get_access_token()
        if access_token is None:
            raise KnotworkAPIError("Missing bearer token in MCP request")
        workspace_id = (
            ctx.request_context.request.headers.get("x-knotwork-workspace-id", "").strip()
        )
        if not workspace_id:
            raise KnotworkAPIError("Missing X-Knotwork-Workspace-Id header")
        return KnotworkAPIClient(
            api_url=settings.normalized_backend_url,
            bearer_token=access_token.token,
            workspace_id=workspace_id,
        )

    async def _request(
        ctx: Context | None,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        api = _client_from_context(ctx)
        return await api.request(method, path, params=params, json_body=body)

    runtime = KnotworkMCPRuntime(
        client_from_context=_client_from_context,
        request=_request,
        json_text=_json_text,
    )

    @mcp.resource(
        "knotwork://workspace/skills",
        name="workspace_skills",
        title="Agent Skills",
        description=(
            "Behavioral context for this workspace — how to authenticate, "
            "available MCP tools, handbook overview, and active channels. "
            "Fetch this on startup to bootstrap workspace context."
        ),
        mime_type="text/markdown",
    )
    async def workspace_skills_resource() -> str:
        ctx = mcp.get_context()
        api = _client_from_context(ctx)
        result = await _request(ctx, "GET", api.workspace_path("/skills"))
        # Client returns {"text": "..."} for non-JSON responses
        if isinstance(result, dict) and "text" in result:
            return result["text"]
        return str(result)

    @mcp.tool()
    async def get_workspace_overview(ctx: Context = None) -> dict[str, Any]:
        api = _client_from_context(ctx)
        runs = await _request(ctx, "GET", api.workspace_path("/runs"))
        escalations = await _request(
            ctx,
            "GET",
            api.workspace_path("/escalations"),
            params={"status": "open"},
        )
        inbox_summary = await _request(ctx, "GET", api.workspace_path("/inbox/summary"))
        participants = await _request(ctx, "GET", api.workspace_path("/participants"))
        agents = await _request(
            ctx, "GET", api.workspace_path("/members"), params={"kind": "agent"}
        )
        health = await _request(ctx, "GET", "/health")

        active_runs = [
            run for run in runs if run.get("status") not in {"completed", "failed", "stopped"}
        ]
        return {
            "workspace_id": api.workspace_id,
            "health": health,
            "active_runs": active_runs,
            "open_escalations": escalations,
            "inbox_summary": inbox_summary,
            "participants": participants,
            "agent_members": agents,
        }

    @mcp.resource(
        "knotwork://workspace/overview",
        name="workspace_overview",
        title="Workspace Overview",
        description="High-level operational snapshot for the configured Knotwork workspace.",
        mime_type="application/json",
    )
    async def workspace_overview_resource() -> str:
        return _json_text(await get_workspace_overview(mcp.get_context()))

    register_enabled_module_mcp_tools(mcp=mcp, runtime=runtime)

    @mcp.tool()
    async def list_mcp_contracts(ctx: Context = None) -> Any:
        api = _client_from_context(ctx)
        return await _request(ctx, "GET", api.workspace_path("/mcp/contracts"))

    @mcp.tool()
    async def get_mcp_contract(contract_id: str, ctx: Context = None) -> Any:
        api = _client_from_context(ctx)
        return await _request(ctx, "GET", api.workspace_path(f"/mcp/contracts/{contract_id}"))

    @mcp.tool()
    async def execute_mcp_action(
        contract_id: str,
        contract_checksum: str,
        action: dict[str, Any],
        fallback_run_id: str | None = None,
        fallback_source_channel_id: str | None = None,
        fallback_trigger_message_id: str | None = None,
        ctx: Context = None,
    ) -> Any:
        api = _client_from_context(ctx)
        return await _request(
            ctx,
            "POST",
            api.workspace_path("/mcp/actions/execute"),
            body={
                "contract_id": contract_id,
                "contract_checksum": contract_checksum,
                "action": action,
                "fallback_run_id": fallback_run_id,
                "fallback_source_channel_id": fallback_source_channel_id,
                "fallback_trigger_message_id": fallback_trigger_message_id,
            },
        )

    return mcp

if __name__ == "__main__":
    build_server().run(transport="streamable-http")

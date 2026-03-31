from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx


class KnotworkAPIError(RuntimeError):
    pass


@dataclass(frozen=True)
class KnotworkMCPSettings:
    api_url: str
    api_token: str
    workspace_id: str
    timeout_seconds: float = 30.0

    @classmethod
    def from_env(cls) -> "KnotworkMCPSettings":
        api_url = os.getenv("KNOTWORK_API_URL", "http://127.0.0.1:8000").rstrip("/")
        api_token = (os.getenv("KNOTWORK_API_TOKEN") or "").strip()
        workspace_id = (os.getenv("KNOTWORK_WORKSPACE_ID") or "").strip()
        timeout_raw = os.getenv("KNOTWORK_MCP_TIMEOUT_SECONDS", "30").strip()

        missing: list[str] = []
        if not api_token:
            missing.append("KNOTWORK_API_TOKEN")
        if not workspace_id:
            missing.append("KNOTWORK_WORKSPACE_ID")
        if missing:
            raise KnotworkAPIError(
                "Missing required MCP environment variables: " + ", ".join(missing)
            )

        try:
            timeout_seconds = float(timeout_raw)
        except ValueError as exc:
            raise KnotworkAPIError(
                f"Invalid KNOTWORK_MCP_TIMEOUT_SECONDS value: {timeout_raw}"
            ) from exc

        return cls(
            api_url=api_url,
            api_token=api_token,
            workspace_id=workspace_id,
            timeout_seconds=timeout_seconds,
        )


class KnotworkAPIClient:
    def __init__(self, settings: KnotworkMCPSettings):
        self.settings = settings

    @property
    def workspace_id(self) -> str:
        return self.settings.workspace_id

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
        url = f"{self.settings.api_url}{path}"
        timeout = httpx.Timeout(self.settings.timeout_seconds)
        headers = {
            "Authorization": f"Bearer {self.settings.api_token}",
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

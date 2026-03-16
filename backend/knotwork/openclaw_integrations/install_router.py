"""OpenClaw plugin install endpoints.

GET /openclaw-plugin/install?token=<handshake_token>

Returns a JSON payload that an OpenClaw agent can use to install and configure
the knotwork-bridge plugin. The user copies this URL from the Knotwork UI and
shares it with their OpenClaw agent.

The response contains:
  - install_command: OpenClaw plugin install command targeting a Knotwork-served tarball
  - config_snippet: the plugin config block for openclaw.config.json
  - verification_command: required post-install check that must succeed
  - requires_user_permission_approval: whether OpenClaw install may pause for human approval
  - instructions: human-readable steps the agent should follow
"""
from __future__ import annotations

import io
import tarfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.openclaw_integrations.models import OpenClawHandshakeToken

router = APIRouter(tags=["openclaw_install"])

_PLUGIN_PACKAGE = "@knotwork/knotwork-bridge"
_PLUGIN_VERSION = "0.2.0"
_PLUGIN_ID = "knotwork-bridge"
_PLUGIN_DIR = Path(__file__).resolve().parents[3] / "openclaw-plugin-knotwork"
_PLUGIN_ARCHIVE_NAME = f"{_PLUGIN_ID}-{_PLUGIN_VERSION}.tar.gz"


def _external_base_url(request: Request) -> str:
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    host = forwarded_host or request.headers.get("host")
    scheme = forwarded_proto or request.url.scheme
    if host:
        return f"{scheme}://{host}".rstrip("/")
    return str(request.base_url).rstrip("/")


def _plugin_archive_url(request: Request) -> str:
    return f"{_external_base_url(request)}/openclaw-plugin/package/{_PLUGIN_ARCHIVE_NAME}"


@router.get("/openclaw-plugin/package/{archive_name}")
async def download_plugin_package(archive_name: str) -> StreamingResponse:
    """Serve the local OpenClaw plugin as a tar.gz archive."""
    if archive_name != _PLUGIN_ARCHIVE_NAME:
        raise HTTPException(status_code=404, detail="Plugin package not found")
    if not _PLUGIN_DIR.exists():
        raise HTTPException(status_code=404, detail="Plugin source directory not found")

    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for path in sorted(_PLUGIN_DIR.rglob("*")):
            if path.name == "node_modules" or "node_modules" in path.parts:
                continue
            tar.add(path, arcname=f"{_PLUGIN_ID}-{_PLUGIN_VERSION}/{path.relative_to(_PLUGIN_DIR)}")
    buffer.seek(0)
    headers = {"Content-Disposition": f'attachment; filename="{_PLUGIN_ARCHIVE_NAME}"'}
    return StreamingResponse(buffer, media_type="application/gzip", headers=headers)


@router.get("/openclaw-plugin/install")
async def get_install_bundle(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return plugin install instructions for an OpenClaw agent.

    Validates the handshake token (must exist and not be expired), then returns
    a JSON payload the agent can act on to install and configure the plugin.
    """
    result = await db.execute(
        select(OpenClawHandshakeToken).where(OpenClawHandshakeToken.token == token)
    )
    token_row: OpenClawHandshakeToken | None = result.scalar_one_or_none()
    if token_row is None:
        raise HTTPException(status_code=404, detail="Token not found")
    # Timezone-safe: SQLite may return naive datetimes for timezone=True columns.
    now_utc = datetime.now(timezone.utc)
    expires_at = token_row.expires_at
    cmp_now = now_utc if expires_at.tzinfo is not None else now_utc.replace(tzinfo=None)
    if expires_at < cmp_now:
        raise HTTPException(status_code=410, detail="Token has expired")

    base_url = _external_base_url(request)

    setup_url = f"{base_url}/openclaw-plugin/install?token={token}"
    package_url = _plugin_archive_url(request)
    install_command = f"openclaw plugins install {package_url}"

    config_snippet = {
        "plugins": {
            "entries": {
                _PLUGIN_ID: {
                    "enabled": True,
                    "package": package_url,
                    "config": {
                        "knotworkBaseUrl": base_url,
                        "handshakeToken": token,
                        "autoHandshakeOnStart": True,
                        "taskPollIntervalMs": 2000,
                    },
                }
            }
        }
    }

    verification_command = "openclaw gateway call knotwork.handshake"

    instructions = (
        "To install the Knotwork bridge plugin in OpenClaw:\n"
        "1. Run the install_command in a terminal where OpenClaw is installed.\n"
        f"   The command installs the tarball served by Knotwork at: {package_url}\n"
        "2. Let the standard OpenClaw installer handle plugin registration and permission approval.\n"
        "3. Persist the returned config_snippet into OpenClaw plugin config (`openclaw.config.json`) if the installer does not do it automatically.\n"
        "4. OpenClaw may require an interactive permission approval step during install.\n"
        "   If an agent is driving installation through chat, it must stop and ask the human operator to approve the requested permissions. It must not assume approval happened automatically.\n"
        "5. Approve/grant the plugin gateway scopes `operator.read` and `operator.write` when OpenClaw prompts for permissions.\n"
        "   If your OpenClaw setup manages plugin permissions in config instead of an interactive prompt, ensure those two scopes are explicitly granted before running Knotwork tasks.\n"
        "6. Restart OpenClaw — the plugin will auto-handshake on startup.\n"
        f"   Setup bundle URL reference: {setup_url}\n"
        "7. Run the verification_command exactly as returned. Installation is not successful until this command exits successfully.\n"
        "8. Verify in Knotwork Settings → Agents → OpenClaw section.\n"
        "9. If you see `missing scope: operator.write` or `missing scope: operator.read`, the plugin was installed without the required gateway permissions. Treat the installation as failed. Reinstall with the standard installer, then restart OpenClaw and run `openclaw gateway call knotwork.handshake` again.\n"
        "10. If OpenClaw starts with `plugin not found: knotwork-bridge`, the standard plugin install did not complete successfully. Treat the installation as failed and rerun the standard installer.\n"
        "11. If OpenClaw starts the plugin without `knotworkBaseUrl`, the install config was not persisted correctly. Treat the installation as failed. Re-apply config_snippet to `openclaw.config.json` and restart OpenClaw."
    )

    return {
        "plugin_package": package_url,
        "plugin_archive_url": package_url,
        "plugin_id": _PLUGIN_ID,
        "setup_url": setup_url,
        "install_command": install_command,
        "config_snippet": config_snippet,
        "verification_command": verification_command,
        "installation_success_criteria": (
            "Installation succeeds only if the plugin starts with the persisted config "
            "and `openclaw gateway call knotwork.handshake` completes without missing-scope "
            "or missing-config errors."
        ),
        "installation_failure_conditions": [
            "OpenClaw permission approval does not grant operator.read",
            "OpenClaw permission approval does not grant operator.write",
            "The standard OpenClaw plugin installation does not complete successfully",
            "The plugin starts without knotworkBaseUrl or handshakeToken persisted in config",
            "The verification_command returns a missing-scope or missing-config error",
        ],
        "required_gateway_scopes": ["operator.read", "operator.write"],
        "required_config_keys": ["knotworkBaseUrl", "handshakeToken"],
        "requires_user_permission_approval": True,
        "agent_install_policy": (
            "If OpenClaw prompts for permission approval, the installing agent must pause and ask the human operator to approve. "
            "The agent must then run the verification_command and mark the installation failed if verification does not succeed."
        ),
        "instructions": instructions,
        "knotwork_base_url": base_url,
        "token": token,
    }

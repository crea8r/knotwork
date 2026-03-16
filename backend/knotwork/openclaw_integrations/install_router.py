"""OpenClaw plugin install endpoint.

GET /openclaw-plugin/install?token=<handshake_token>

Returns a JSON payload that an OpenClaw agent can use to install and configure
the knotwork-bridge plugin. The user copies this URL from the Knotwork UI and
shares it with their OpenClaw agent.

The response contains:
  - uninstall_command: removes the existing plugin registration
  - cleanup_command: deletes the installed plugin folder from OpenClaw extensions
  - download_command: fetches the configured plugin artifact to a local file
  - install_command: installs the plugin from the downloaded local file
  - config_snippet: the plugin config block for ~/.openclaw/openclaw.json
  - verification_command: required post-install check that must succeed
  - requires_user_permission_approval: whether OpenClaw install may pause for human approval
  - instructions: human-readable steps the agent should follow
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.config import settings
from knotwork.database import get_db
from knotwork.openclaw_integrations.models import OpenClawHandshakeToken

router = APIRouter(tags=["openclaw_install"])

_PLUGIN_VERSION = "0.2.0"
_PLUGIN_ID = "knotwork-bridge"


def _external_base_url(request: Request) -> str:
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    host = forwarded_host or request.headers.get("host")
    scheme = forwarded_proto or request.url.scheme
    if host:
        return f"{scheme}://{host}".rstrip("/")
    return str(request.base_url).rstrip("/")


def _plugin_package_url() -> str:
    return settings.openclaw_plugin_package_url.strip()


def _local_plugin_filename(package_url: str) -> str:
    name = PurePosixPath(package_url).name
    return name or f"{_PLUGIN_ID}-{_PLUGIN_VERSION}.tar.gz"


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
    package_url = _plugin_package_url()
    if not package_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenClaw plugin package URL is not configured",
        )

    setup_url = f"{base_url}/openclaw-plugin/install?token={token}"
    local_package_file = _local_plugin_filename(package_url)
    uninstall_command = f'openclaw plugins uninstall "{_PLUGIN_ID}"'
    cleanup_command = f'rm -rf ~/.openclaw/extensions/{_PLUGIN_ID}'
    download_command = f'curl -fL "{package_url}" -o "{local_package_file}"'
    install_command = f'openclaw plugins install "{local_package_file}"'

    config_snippet = {
        "plugins": {
            "entries": {
                _PLUGIN_ID: {
                    "enabled": True,
                    "package": package_url,
                    "config": {
                        "knotworkBackendUrl": base_url,
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
        "1. Run the uninstall_command first to remove any existing knotwork-bridge install.\n"
        f"2. Delete the existing plugin folder if it exists: ~/.openclaw/extensions/{_PLUGIN_ID}\n"
        "   Use cleanup_command for this step.\n"
        "3. Run the download_command in a terminal where OpenClaw is installed.\n"
        f"   This downloads the configured plugin artifact from: {package_url}\n"
        f"4. Run the install_command to install the downloaded local file: {local_package_file}\n"
        "5. Let the standard OpenClaw installer handle plugin registration and permission approval.\n"
        "6. Update ~/.openclaw/openclaw.json with the returned config_snippet so the plugin has the right knotworkBackendUrl and handshakeToken.\n"
        "7. OpenClaw may require an interactive permission approval step during install.\n"
        "   If an agent is driving installation through chat, it must stop and ask the human operator to approve the requested permissions. It must not assume approval happened automatically.\n"
        "8. Approve/grant the plugin gateway scopes `operator.read` and `operator.write` when OpenClaw prompts for permissions.\n"
        "   If your OpenClaw setup manages plugin permissions in config instead of an interactive prompt, ensure those two scopes are explicitly granted before running Knotwork tasks.\n"
        "9. Ask the user to restart the OpenClaw gateway to make sure the new plugin config is loaded.\n"
        f"   Setup bundle URL reference: {setup_url}\n"
        "10. Run the verification_command exactly as returned. Installation is not successful until this command exits successfully.\n"
        "11. Verify in Knotwork Settings → Agents → OpenClaw section.\n"
        "12. If you see `missing scope: operator.write` or `missing scope: operator.read`, the plugin was installed without the required gateway permissions. Treat the installation as failed. Reinstall with the standard installer, then restart OpenClaw and run `openclaw gateway call knotwork.handshake` again.\n"
        "13. If OpenClaw starts with `plugin not found: knotwork-bridge`, the standard plugin install did not complete successfully. Treat the installation as failed and rerun the standard installer.\n"
        "14. If OpenClaw starts the plugin without `knotworkBackendUrl` or `handshakeToken`, the install config was not persisted correctly. Treat the installation as failed. Re-apply config_snippet to ~/.openclaw/openclaw.json, restart the OpenClaw gateway, and run verification again."
    )

    return {
        "plugin_package": package_url,
        "plugin_archive_url": package_url,
        "local_package_file": local_package_file,
        "plugin_id": _PLUGIN_ID,
        "setup_url": setup_url,
        "uninstall_command": uninstall_command,
        "cleanup_command": cleanup_command,
        "download_command": download_command,
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
            "The plugin starts without knotworkBackendUrl or handshakeToken persisted in config",
            "The verification_command returns a missing-scope or missing-config error",
        ],
        "required_gateway_scopes": ["operator.read", "operator.write"],
        "required_config_keys": ["knotworkBackendUrl", "handshakeToken"],
        "requires_user_permission_approval": True,
        "agent_install_policy": (
            "If OpenClaw prompts for permission approval, the installing agent must pause and ask the human operator to approve. "
            "After installation it must update ~/.openclaw/openclaw.json with knotworkBackendUrl and handshakeToken, ask the user to restart the OpenClaw gateway, then run the verification_command and mark the installation failed if verification does not succeed."
        ),
        "instructions": instructions,
        "knotwork_backend_url": base_url,
        "token": token,
    }

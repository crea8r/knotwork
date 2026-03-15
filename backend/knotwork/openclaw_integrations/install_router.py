"""OpenClaw plugin install endpoint.

GET /openclaw-plugin/install?token=<handshake_token>

Returns a JSON payload that an OpenClaw agent can use to install and configure
the knotwork-bridge plugin. The user copies this URL from the Knotwork UI and
shares it with their OpenClaw agent.

The response contains:
  - install_command: standard OpenClaw plugin install command for the published package
  - config_snippet: the plugin config block for openclaw.config.json
  - verification_command: required post-install check that must succeed
  - requires_user_permission_approval: whether OpenClaw install may pause for human approval
  - instructions: human-readable steps the agent should follow
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.config import settings
from knotwork.openclaw_integrations.models import OpenClawHandshakeToken

router = APIRouter(tags=["openclaw_install"])

_PLUGIN_PACKAGE = "@knotwork/knotwork-bridge"
_PLUGIN_VERSION = "0.2.0"
_PLUGIN_ID = "knotwork-bridge"


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

    base_url = settings.normalized_backend_url

    setup_url = f"{base_url}/openclaw-plugin/install?token={token}"
    install_command = f"openclaw plugins install {_PLUGIN_PACKAGE}@{_PLUGIN_VERSION}"

    config_snippet = {
        "plugins": {
            "entries": {
                _PLUGIN_ID: {
                    "enabled": True,
                    "package": f"{_PLUGIN_PACKAGE}@{_PLUGIN_VERSION}",
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
        "2. Let the standard OpenClaw installer handle plugin registration and permission approval.\n"
        "3. Fetch the setup_url and persist the returned config_snippet into OpenClaw plugin config (`openclaw.config.json`) if the installer does not do it automatically.\n"
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
        "plugin_package": f"{_PLUGIN_PACKAGE}@{_PLUGIN_VERSION}",
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

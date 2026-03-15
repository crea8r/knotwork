"""OpenClaw plugin install endpoint.

GET /openclaw-plugin/install?token=<handshake_token>

Returns a JSON payload that an OpenClaw agent can use to install and configure
the knotwork-bridge plugin. The user copies this URL from the Knotwork UI and
shares it with their OpenClaw agent.

The response contains:
  - install_command: full shell command to install + configure the plugin
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
from knotwork.openclaw_integrations.models import OpenClawHandshakeToken

router = APIRouter(tags=["openclaw_install"])

_PLUGIN_PACKAGE = "@knotwork/knotwork-bridge"
_PLUGIN_VERSION = "0.2.0"
_PLUGIN_ID = "knotwork-bridge"
_PLUGIN_INSTALL_DIR_TEMPLATE = "${HOME}/.openclaw/knotwork-plugin"


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

    # Derive the Knotwork base URL from the incoming request so this works in any environment
    base_url = str(request.base_url).rstrip("/")

    install_command = (
        f'PLUGIN_DIR="{_PLUGIN_INSTALL_DIR_TEMPLATE}" && '
        f'mkdir -p "$PLUGIN_DIR" && '
        f'npm pack {_PLUGIN_PACKAGE}@{_PLUGIN_VERSION} --pack-destination "$PLUGIN_DIR" && '
        f'cd "$PLUGIN_DIR" && '
        f'tar -xzf knotwork-knotwork-bridge-{_PLUGIN_VERSION}.tgz --strip-components=1 package && '
        f'rm -f knotwork-knotwork-bridge-{_PLUGIN_VERSION}.tgz'
    )

    config_snippet = {
        "plugins": {
            "load": {
                "paths": [
                    "__OPENCLAW_PLUGIN_DIR__"
                ]
            },
            "entries": {
                _PLUGIN_ID: {
                    "enabled": True,
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
        "2. Resolve the absolute plugin directory used by install_command and replace `__OPENCLAW_PLUGIN_DIR__` in config_snippet with that absolute path.\n"
        "3. Persist the returned config_snippet into OpenClaw plugin config (`openclaw.config.json`). The plugin must be discoverable through `plugins.load.paths`; do not rely on `entries.*.package`.\n"
        "4. OpenClaw may require an interactive permission approval step during install.\n"
        "   If an agent is driving installation through chat, it must stop and ask the human operator to approve the requested permissions. It must not assume approval happened automatically.\n"
        "5. Approve/grant the plugin gateway scopes `operator.read` and `operator.write` when OpenClaw prompts for permissions.\n"
        "   If your OpenClaw setup manages plugin permissions in config instead of an interactive prompt, ensure those two scopes are explicitly granted before running Knotwork tasks.\n"
        "6. If openclaw supports URL-based install: "
        f"  openclaw plugin install {base_url}/openclaw-plugin/install?token={token}\n"
        "7. Restart OpenClaw — the plugin will auto-handshake on startup.\n"
        "8. Run the verification_command exactly as returned. Installation is not successful until this command exits successfully.\n"
        "9. Verify in Knotwork Settings → Agents → OpenClaw section.\n"
        "10. If you see `missing scope: operator.write` or `missing scope: operator.read`, the plugin was installed without the required gateway permissions. Treat the installation as failed. Reinstall or update plugin permissions, then restart OpenClaw and run `openclaw gateway call knotwork.handshake` again.\n"
        "11. If OpenClaw starts with `plugin not found: knotwork-bridge`, the plugin directory was not added correctly to `plugins.load.paths`. Treat the installation as failed and fix the absolute plugin path in config.\n"
        "12. If OpenClaw starts the plugin without `knotworkBaseUrl`, the install was not persisted correctly. Treat the installation as failed. Re-apply config_snippet to `openclaw.config.json` and restart OpenClaw."
    )

    return {
        "plugin_package": f"{_PLUGIN_PACKAGE}@{_PLUGIN_VERSION}",
        "plugin_id": _PLUGIN_ID,
        "plugin_install_dir_template": _PLUGIN_INSTALL_DIR_TEMPLATE,
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
            "The plugin is not discoverable through plugins.load.paths",
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

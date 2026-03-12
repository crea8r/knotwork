"""OpenClaw plugin install endpoint.

GET /openclaw-plugin/install?token=<handshake_token>

Returns a JSON payload that an OpenClaw agent can use to install and configure
the knotwork-bridge plugin. The user copies this URL from the Knotwork UI and
shares it with their OpenClaw agent.

The response contains:
  - install_command: full shell command to install + configure the plugin
  - config_snippet: the plugin config block for openclaw.config.json
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
        f"KNOTWORK_BASE_URL={base_url} "
        f"KNOTWORK_HANDSHAKE_TOKEN={token} "
        f"openclaw plugin install {_PLUGIN_PACKAGE}@{_PLUGIN_VERSION}"
    )

    config_snippet = {
        "plugins": {
            "entries": {
                "knotwork-bridge": {
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

    instructions = (
        "To install the Knotwork bridge plugin in OpenClaw:\n"
        "1. Run the install_command in a terminal where OpenClaw is installed.\n"
        "2. If openclaw supports URL-based install: "
        f"  openclaw plugin install {base_url}/openclaw-plugin/install?token={token}\n"
        "3. Restart OpenClaw — the plugin will auto-handshake on startup.\n"
        "4. Verify in Knotwork Settings → Agents → OpenClaw section."
    )

    return {
        "plugin_package": f"{_PLUGIN_PACKAGE}@{_PLUGIN_VERSION}",
        "install_command": install_command,
        "config_snippet": config_snippet,
        "instructions": instructions,
        "knotwork_base_url": base_url,
        "token": token,
    }

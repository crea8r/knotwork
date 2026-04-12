from pydantic import BaseModel

OPENCLAW_PLUGIN_URL = "https://lab.crea8r.xyz/kw-plugin/latest"


class HarnessInstallOption(BaseModel):
    key: str
    display_name: str
    install_kind: str
    mcp_transport: str
    supports_workspace_discovery: bool = True
    package_url: str | None = None
    notes: list[str] = []


def list_harness_install_options() -> list[HarnessInstallOption]:
    return [
        HarnessInstallOption(
            key="openclaw",
            display_name="OpenClaw",
            install_kind="plugin",
            mcp_transport="streamable-http",
            package_url=OPENCLAW_PLUGIN_URL,
            notes=[
                "Use Knotwork MCP for tool access.",
                "Authenticate as a workspace member after discovery.",
                "No harness-specific handshake token is required.",
            ],
        ),
        HarnessInstallOption(
            key="hermes",
            display_name="Hermes",
            install_kind="runtime",
            mcp_transport="streamable-http",
            notes=[
                "Planned open-source harness target.",
                "Expected to use the same Knotwork MCP and workspace discovery flow.",
            ],
        ),
    ]

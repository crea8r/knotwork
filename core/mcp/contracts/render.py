from __future__ import annotations

import json

from .schemas import MCPContractAction, MCPContractManifest


def _render_action(action: MCPContractAction) -> str:
    metadata: list[str] = [f"- Kind: `{action.kind}`"]
    if action.context_section:
        metadata.append(f"- Context section: `{action.context_section}`")
    if action.visibility:
        metadata.append(f"- Visibility: `{action.visibility}`")
    return "\n".join(
        [
            f"### `{action.name}`",
            action.description,
            "",
            *metadata,
            "",
            "Target schema:",
            "```json",
            json.dumps(action.target_schema, indent=2, sort_keys=True),
            "```",
            "",
            "Payload schema:",
            "```json",
            json.dumps(action.payload_schema, indent=2, sort_keys=True),
            "```",
            "",
            "Output schema:" if action.output_schema else "",
            "```json" if action.output_schema else "",
            json.dumps(action.output_schema, indent=2, sort_keys=True) if action.output_schema else "",
            "```" if action.output_schema else "",
        ]
    )


def render_mcp_contract_markdown(manifest: MCPContractManifest) -> str:
    examples = "\n\n".join(
        "\n".join(
            [
                f"### {example.summary}",
                "```json-action",
                json.dumps(example.action, indent=2, sort_keys=True),
                "```",
            ]
        )
        for example in manifest.examples
    )
    actions = "\n\n".join(_render_action(action) for action in manifest.actions)
    instructions = "\n".join(f"- {item}" for item in manifest.instructions) or "- None"
    sections = "\n".join(f"- `{item}`" for item in manifest.context_sections) or "- None"
    allowed = "\n".join(f"- `{item}`" for item in manifest.allowed_actions) or "- None"
    session_types = "\n".join(f"- `{item}`" for item in manifest.session_types) or "- None"

    parts = [
        f"# {manifest.title}",
        "",
        f"- Contract: `{manifest.id}`",
        f"- Owning module: `{manifest.owning_module}`",
        "",
        "## Session Types",
        session_types,
        "",
        "## Allowed Actions",
        allowed,
        "",
        "## Context Sections",
        sections,
        "",
        "## Instructions",
        instructions,
        "",
        "## Actions",
        actions or "No actions.",
    ]
    if examples:
        parts.extend(["", "## Examples", examples])
    return "\n".join(parts).strip() + "\n"


def render_mcp_contract_registry_markdown(
    *, distribution_code: str, generated_at: str, manifests: list[MCPContractManifest]
) -> str:
    rendered = [
        "# Knotwork MCP Contract Registry",
        "",
        f"- Distribution: `{distribution_code}`",
        f"- Generated at: `{generated_at}`",
        "",
    ]
    for manifest in manifests:
        rendered.extend(
            [
                f"---",
                "",
                render_mcp_contract_markdown(manifest).rstrip(),
                "",
            ]
        )
    return "\n".join(rendered).strip() + "\n"

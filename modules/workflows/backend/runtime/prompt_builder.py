"""
Prompt construction for LLM Agent nodes.

RULE: Always use build_agent_prompt() — never construct prompts inline in node code.

Every LLM Agent node gets exactly two sections:
  === GUIDELINES (how to work) ===
  [knowledge tree — ordered: universal files first, then domain files]

  === THIS CASE (what you are working on) ===
  [extracted run state fields + Run Context file contents]

This separation ensures the LLM always knows the difference between
a general procedure and the specific case it is working on.
"""

import json

from .knowledge_loader import KnowledgeTree, LoadedFragment


def _order_fragments(fragments: list[LoadedFragment]) -> list[LoadedFragment]:
    """Universal (shared/root) files first, then domain files alphabetically."""
    universal = [f for f in fragments if f.domain == "shared"]
    domain = [f for f in fragments if f.domain != "shared"]
    return universal + sorted(domain, key=lambda f: (f.domain, f.path))


def _render_guidelines(tree: KnowledgeTree) -> str:
    """Render the knowledge tree as a structured guidelines section."""
    sections = []

    if not tree.fragments:
        sections.append("(No guidelines loaded for this node.)")
    else:
        ordered = _order_fragments(tree.fragments)
        for fragment in ordered:
            header = f"## [{fragment.domain.upper()}] {fragment.path}"
            if fragment.referenced_from:
                header += f"\n> Referenced from: {fragment.referenced_from}"
            sections.append(f"{header}\n\n{fragment.content}")

    if tree.missing_links:
        missing = ", ".join(tree.missing_links)
        sections.append(f"## WARNING\nThe following linked files were not found: {missing}")

    return "\n\n---\n\n".join(sections)


def _render_case(
    state_fields: dict,
    context_files: list[dict],
    project_context: str = "",
    prior_outputs: dict[str, str] | None = None,
) -> str:
    """Render run state, prior outputs, and attachment metadata (never file content)."""
    parts = []

    if state_fields:
        parts.append("### Run input\n```json\n" + json.dumps(state_fields, indent=2) + "\n```")

    if project_context.strip():
        parts.append(f"### Project context\n{project_context.strip()}")

    if prior_outputs:
        for node_id, text in prior_outputs.items():
            parts.append(f"### Output from node: {node_id}\n{text}")

    if context_files:
        lines = []
        for f in context_files:
            filename = str(f.get("filename") or f.get("name") or "file")
            mime = str(f.get("mime_type") or "application/octet-stream")
            size = f.get("size")
            size_label = f"{size} bytes" if isinstance(size, int) else "size unknown"
            lines.append(f"- {filename} ({mime}, {size_label})")
        parts.append(
            "### Attached files\n"
            "Files are available to the agent via attachment URLs in the execution task.\n"
            + "\n".join(lines)
        )

    return "\n\n".join(parts) if parts else "(No case data provided.)"


def build_agent_prompt(
    tree: KnowledgeTree,
    state_fields: dict,
    context_files: list[dict] | None = None,
    project_context: str = "",
    prior_outputs: dict[str, str] | None = None,
) -> tuple[str, str]:
    """
    Build the (system_prompt, user_prompt) for an LLM Agent node.

    Args:
        tree:           Loaded knowledge tree from load_knowledge_tree().
        state_fields:   The subset of run state this node receives (input_mapping applied).
        context_files:  Run attachments metadata and URLs (no file content).

    Returns:
        (system_prompt, user_prompt) — pass directly to the LLM.
    """
    guidelines = _render_guidelines(tree)
    case = _render_case(state_fields, context_files or [], project_context, prior_outputs)

    system_prompt = f"=== GUIDELINES (how to work) ===\n\n{guidelines}"
    user_prompt = f"=== THIS CASE (what you are working on) ===\n\n{case}"

    return system_prompt, user_prompt

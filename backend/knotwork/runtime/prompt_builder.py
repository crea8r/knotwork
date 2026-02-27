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

from knotwork.runtime.knowledge_loader import KnowledgeTree, LoadedFragment


def _order_fragments(fragments: list[LoadedFragment]) -> list[LoadedFragment]:
    """Universal (shared/root) files first, then domain files alphabetically."""
    universal = [f for f in fragments if f.domain == "shared"]
    domain = [f for f in fragments if f.domain != "shared"]
    return universal + sorted(domain, key=lambda f: (f.domain, f.path))


def _render_guidelines(tree: KnowledgeTree) -> str:
    """Render the knowledge tree as a structured guidelines section."""
    if not tree.fragments:
        return "(No guidelines loaded for this node.)"

    ordered = _order_fragments(tree.fragments)
    sections = []
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
) -> str:
    """Render the run state and attached files as a structured case section."""
    parts = []

    if state_fields:
        parts.append("### Run state\n```json\n" + json.dumps(state_fields, indent=2) + "\n```")

    for f in context_files:
        name = f.get("name", "file")
        content = f.get("content", "")
        parts.append(f"### Attached file: {name}\n{content}")

    return "\n\n".join(parts) if parts else "(No case data provided.)"


def build_agent_prompt(
    tree: KnowledgeTree,
    state_fields: dict,
    context_files: list[dict] | None = None,
) -> tuple[str, str]:
    """
    Build the (system_prompt, user_prompt) for an LLM Agent node.

    Args:
        tree:           Loaded knowledge tree from load_knowledge_tree().
        state_fields:   The subset of run state this node receives (input_mapping applied).
        context_files:  Run Context files: [{"name": "contract.pdf", "content": "..."}].

    Returns:
        (system_prompt, user_prompt) — pass directly to the LLM.
    """
    guidelines = _render_guidelines(tree)
    case = _render_case(state_fields, context_files or [])

    system_prompt = f"=== GUIDELINES (how to work) ===\n\n{guidelines}"
    user_prompt = f"=== THIS CASE (what you are working on) ===\n\n{case}"

    return system_prompt, user_prompt

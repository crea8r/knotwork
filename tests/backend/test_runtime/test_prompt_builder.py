"""Tests for runtime/prompt_builder.py"""

from modules.workflows.backend.runtime.knowledge_loader import KnowledgeTree, LoadedFragment
from modules.workflows.backend.runtime.prompt_builder import build_agent_prompt


def make_tree(*fragments: tuple[str, str, str]) -> KnowledgeTree:
    """Helper: (path, content, domain) tuples → KnowledgeTree."""
    tree = KnowledgeTree()
    for path, content, domain in fragments:
        tree.fragments.append(LoadedFragment(
            path=path, content=content, version_id="v1", domain=domain
        ))
    return tree


def test_system_prompt_contains_guidelines_header():
    tree = make_tree(("legal/guide.md", "# Guide", "legal"))
    system, _ = build_agent_prompt(tree, {})
    assert "=== GUIDELINES (how to work) ===" in system


def test_user_prompt_contains_case_header():
    tree = make_tree(("legal/guide.md", "# Guide", "legal"))
    _, user = build_agent_prompt(tree, {"contract_type": "purchase"})
    assert "=== THIS CASE (what you are working on) ===" in user


def test_universal_fragments_appear_before_domain():
    tree = make_tree(
        ("legal/guide.md", "domain content", "legal"),
        ("shared/tone.md", "universal content", "shared"),
    )
    system, _ = build_agent_prompt(tree, {})
    assert system.index("universal content") < system.index("domain content")


def test_state_fields_in_user_prompt():
    tree = KnowledgeTree()
    _, user = build_agent_prompt(tree, {"contract_type": "purchase", "value": 1000})
    assert "purchase" in user
    assert "1000" in user


def test_context_files_in_user_prompt():
    tree = KnowledgeTree()
    files = [{
        "filename": "contract.pdf",
        "mime_type": "application/pdf",
        "size": 1234,
        "url": "https://example.test/file.pdf",
    }]
    _, user = build_agent_prompt(tree, {}, context_files=files)
    assert "contract.pdf" in user
    assert "application/pdf" in user
    assert "1234 bytes" in user


def test_empty_tree_has_fallback_message():
    tree = KnowledgeTree()
    system, _ = build_agent_prompt(tree, {})
    assert "No guidelines loaded" in system


def test_missing_links_warning_in_system_prompt():
    tree = KnowledgeTree()
    tree.missing_links = ["legal/missing.md"]
    system, _ = build_agent_prompt(tree, {})
    assert "missing.md" in system
    assert "WARNING" in system

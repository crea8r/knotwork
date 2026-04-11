"""
Tests for runtime/knowledge_loader.py

Covers: domain detection, link resolution, folder-as-domain traversal,
        loop prevention, missing link handling.
"""

import pytest
from unittest.mock import AsyncMock, patch

from modules.workflows.backend.runtime.knowledge_loader import (
    KnowledgeTree,
    extract_wiki_links,
    get_domain,
    is_universal,
    load_knowledge_tree,
    resolve_link,
)


# --- Unit tests: pure functions ---

def test_get_domain_root_file():
    assert get_domain("company-tone.md") == "shared"

def test_get_domain_shared_folder():
    assert get_domain("shared/guidelines.md") == "shared"

def test_get_domain_templates_folder():
    assert get_domain("templates/contract.md") == "shared"

def test_get_domain_legal_folder():
    assert get_domain("legal/contract-review.md") == "legal"

def test_get_domain_finance_folder():
    assert get_domain("finance/ratios.md") == "finance"

def test_is_universal_shared():
    assert is_universal("shared/tone.md") is True

def test_is_universal_domain():
    assert is_universal("legal/guide.md") is False

def test_extract_wiki_links():
    content = "See [[red-flags]] and [[finance/ratios]] for detail."
    assert extract_wiki_links(content) == ["red-flags", "finance/ratios"]

def test_extract_wiki_links_empty():
    assert extract_wiki_links("No links here.") == []

def test_resolve_link_relative():
    assert resolve_link("legal/guide.md", "red-flags") == "legal/red-flags.md"

def test_resolve_link_absolute():
    assert resolve_link("legal/guide.md", "shared/tone") == "shared/tone.md"

def test_resolve_link_already_md():
    assert resolve_link("legal/guide.md", "red-flags.md") == "legal/red-flags.md"

def test_resolve_link_root_file():
    assert resolve_link("company.md", "legal/guide") == "legal/guide.md"


# --- Integration tests: load_knowledge_tree ---

def make_adapter(files: dict[str, str]):
    """Create a mock StorageAdapter with given path→content mapping."""
    from modules.assets.backend.storage.adapter import FileContent

    async def read(workspace_id: str, path: str) -> FileContent:
        if path not in files:
            raise FileNotFoundError(path)
        return FileContent(content=files[path], version_id=f"v_{path}", path=path)

    adapter = AsyncMock()
    adapter.read = read
    return adapter


@pytest.mark.asyncio
async def test_loads_root_fragment():
    files = {"legal/guide.md": "# Legal Guide\nNo links."}
    with patch("modules.workflows.backend.runtime.knowledge_loader.get_storage_adapter", return_value=make_adapter(files)):
        tree = await load_knowledge_tree(["legal/guide.md"], "ws-1")
    assert len(tree.fragments) == 1
    assert tree.fragments[0].path == "legal/guide.md"


@pytest.mark.asyncio
async def test_follows_same_domain_links():
    files = {
        "legal/guide.md": "See [[red-flags]]",
        "legal/red-flags.md": "# Red Flags",
    }
    with patch("modules.workflows.backend.runtime.knowledge_loader.get_storage_adapter", return_value=make_adapter(files)):
        tree = await load_knowledge_tree(["legal/guide.md"], "ws-1")
    paths = {f.path for f in tree.fragments}
    assert "legal/red-flags.md" in paths


@pytest.mark.asyncio
async def test_blocks_cross_domain_links():
    """Legal node must not load finance files transitively."""
    files = {
        "legal/guide.md": "See [[finance/ratios]]",
        "finance/ratios.md": "# Finance Ratios",
    }
    with patch("modules.workflows.backend.runtime.knowledge_loader.get_storage_adapter", return_value=make_adapter(files)):
        tree = await load_knowledge_tree(["legal/guide.md"], "ws-1")
    paths = {f.path for f in tree.fragments}
    assert "finance/ratios.md" not in paths


@pytest.mark.asyncio
async def test_follows_shared_links_always():
    """Universal (shared/) files are always loaded regardless of active domain."""
    files = {
        "legal/guide.md": "See [[shared/tone]]",
        "shared/tone.md": "# Company Tone",
    }
    with patch("modules.workflows.backend.runtime.knowledge_loader.get_storage_adapter", return_value=make_adapter(files)):
        tree = await load_knowledge_tree(["legal/guide.md"], "ws-1")
    paths = {f.path for f in tree.fragments}
    assert "shared/tone.md" in paths


@pytest.mark.asyncio
async def test_no_duplicates_on_multiple_references():
    """A file referenced via multiple paths is loaded only once."""
    files = {
        "legal/a.md": "See [[shared/tone]]",
        "legal/b.md": "See [[shared/tone]]",
        "shared/tone.md": "# Tone",
    }
    with patch("modules.workflows.backend.runtime.knowledge_loader.get_storage_adapter", return_value=make_adapter(files)):
        tree = await load_knowledge_tree(["legal/a.md", "legal/b.md"], "ws-1")
    tone_count = sum(1 for f in tree.fragments if f.path == "shared/tone.md")
    assert tone_count == 1


@pytest.mark.asyncio
async def test_circular_links_no_infinite_loop():
    """Circular [[links]] must not cause infinite recursion."""
    files = {
        "legal/a.md": "See [[b]]",
        "legal/b.md": "See [[a]]",
    }
    with patch("modules.workflows.backend.runtime.knowledge_loader.get_storage_adapter", return_value=make_adapter(files)):
        tree = await load_knowledge_tree(["legal/a.md"], "ws-1")
    assert len(tree.fragments) == 2


@pytest.mark.asyncio
async def test_missing_link_recorded_not_raised():
    files = {"legal/guide.md": "See [[missing-file]]"}
    with patch("modules.workflows.backend.runtime.knowledge_loader.get_storage_adapter", return_value=make_adapter(files)):
        tree = await load_knowledge_tree(["legal/guide.md"], "ws-1")
    assert "legal/missing-file.md" in tree.missing_links
    assert len(tree.fragments) == 1


@pytest.mark.asyncio
async def test_version_snapshot():
    files = {"legal/guide.md": "# Guide"}
    with patch("modules.workflows.backend.runtime.knowledge_loader.get_storage_adapter", return_value=make_adapter(files)):
        tree = await load_knowledge_tree(["legal/guide.md"], "ws-1")
    assert tree.version_snapshot == {"legal/guide.md": "v_legal/guide.md"}

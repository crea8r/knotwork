"""
Knowledge tree loader with folder-as-domain traversal.

RULE: Always use load_knowledge_tree() — never load files directly in node code.

Folder-as-domain rule:
  - Files in shared/ or root level are UNIVERSAL — their links are always followed.
  - Files in domain folders (legal/, finance/, etc.) are DOMAIN-SCOPED.
  - Transitive links are only followed if the target domain is in the active set.
  - Active domains = {domains of all directly referenced root files} ∪ {shared}.

This prevents a legal node from loading finance content just because
company-guideline.md happens to link to finance/ratios.md.
"""

import re
from dataclasses import dataclass, field

from core.api.knowledge import get_storage_adapter


@dataclass
class LoadedFragment:
    path: str
    content: str
    version_id: str
    domain: str         # top-level folder name, or "shared" for root files
    referenced_from: str | None = None   # which file included this one


@dataclass
class KnowledgeTree:
    fragments: list[LoadedFragment] = field(default_factory=list)
    missing_links: list[str] = field(default_factory=list)

    @property
    def version_snapshot(self) -> dict[str, str]:
        """Returns {path: version_id} — stored in RunNodeState for reproducibility."""
        return {f.path: f.version_id for f in self.fragments}

    @property
    def total_tokens(self) -> int:
        """Approximate token count of the full tree. Uses ~4 chars/token heuristic."""
        total_chars = sum(len(f.content) for f in self.fragments)
        return total_chars // 4


def get_domain(path: str) -> str:
    """
    Returns the domain of a file path.
    'legal/contract-review.md' → 'legal'
    'company-tone.md'          → 'shared'  (root-level = universal)
    'shared/guidelines.md'     → 'shared'
    'templates/contract.md'    → 'shared'  (templates = universal)
    """
    parts = path.strip("/").split("/")
    if len(parts) == 1:
        return "shared"
    top = parts[0].lower()
    if top in ("shared", "templates"):
        return "shared"
    return top


def is_universal(path: str) -> bool:
    return get_domain(path) == "shared"


def extract_wiki_links(content: str) -> list[str]:
    """Extract [[link]] references from markdown content."""
    return re.findall(r"\[\[([^\]]+)\]\]", content)


def resolve_link(current_path: str, link: str) -> str:
    """
    Resolve a [[link]] relative to the current file's folder.
    Adds .md extension if missing.
    'legal/guide.md' + '[[red-flags]]'       → 'legal/red-flags.md'
    'legal/guide.md' + '[[shared/tone]]'     → 'shared/tone.md'
    'company.md'     + '[[legal/contract]]'  → 'legal/contract.md'
    """
    if not link.endswith(".md"):
        link = link + ".md"
    if "/" in link:
        return link   # already an absolute path from workspace root
    folder = "/".join(current_path.split("/")[:-1])
    return f"{folder}/{link}" if folder else link


async def load_knowledge_tree(
    fragment_paths: list[str],
    workspace_id: str,
) -> KnowledgeTree:
    """
    Load a knowledge tree for a node execution.

    Args:
        fragment_paths: Paths directly referenced by the node config.
        workspace_id:   The workspace owning these files.

    Returns:
        KnowledgeTree with all loaded fragments and their version IDs.
    """
    adapter = get_storage_adapter()
    active_domains = {get_domain(p) for p in fragment_paths} | {"shared"}
    visited: set[str] = set()
    tree = KnowledgeTree()

    async def load(path: str, referenced_from: str | None = None) -> None:
        if path in visited:
            return
        visited.add(path)

        try:
            file = await adapter.read(workspace_id, path)
        except FileNotFoundError:
            tree.missing_links.append(path)
            return

        domain = get_domain(path)
        tree.fragments.append(LoadedFragment(
            path=path,
            content=file.content,
            version_id=file.version_id,
            domain=domain,
            referenced_from=referenced_from,
        ))

        for link in extract_wiki_links(file.content):
            target = resolve_link(path, link)
            target_domain = get_domain(target)

            should_follow = (
                is_universal(path)          # current file is universal → follow all
                or is_universal(target)     # target is universal → always follow
                or target_domain in active_domains  # target domain is active
            )
            if should_follow:
                await load(target, referenced_from=path)

    for path in fragment_paths:
        await load(path, referenced_from=None)

    return tree

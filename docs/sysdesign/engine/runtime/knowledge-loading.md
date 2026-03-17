# Runtime Specification — Knowledge Loading

## Folder-as-Domain Rule

The folder a file lives in defines its **domain**. When traversing transitive links, only links into active domains are followed.

- `shared/` and root-level files are **universal** — their links are always followed
- Domain-folder files (`legal/`, `finance/`, etc.) are **domain-scoped** — their links are only followed if that domain is active

**Active domains** = the set of folder names of all files the node directly references, plus `shared`.

```python
def get_domain(path: str) -> str:
    """Returns the top-level folder name, or 'shared' for root-level files."""
    parts = path.split("/")
    return parts[0] if len(parts) > 1 else "shared"

def is_universal(path: str) -> bool:
    domain = get_domain(path)
    return domain in ("shared", "templates") or "/" not in path

async def load_knowledge_tree(
    fragment_paths: list[str],
    workspace_id: str,
) -> dict[str, dict]:
    """
    Returns {path: {content, version_id}} for the root fragments
    and all transitively linked fragments, filtered by domain.

    Rules:
    - Each file is loaded at most once (visited set prevents loops/duplication)
    - Active domains = domains of directly referenced root files + shared
    - Universal files (shared/, root-level): follow all their links
    - Domain files: only follow links into active domains
    """
    active_domains = {get_domain(p) for p in fragment_paths} | {"shared"}
    visited = set()
    result = {}

    async def load(path: str, from_universal: bool = False):
        if path in visited:
            return
        visited.add(path)

        try:
            content, version_id = await storage_adapter.read(workspace_id, path)
        except FileNotFoundError:
            log_warning(f"Knowledge link not found: {path}")
            return

        result[path] = {
            "content": content,
            "version_id": version_id,
            "domain": get_domain(path),
        }

        links = extract_wiki_links(content)
        for link in links:
            resolved = resolve_link(path, link)
            target_domain = get_domain(resolved)

            # Follow the link if:
            # - this file is universal (shared/root), OR
            # - the target is universal, OR
            # - the target domain is active
            if (
                is_universal(path)
                or is_universal(resolved)
                or target_domain in active_domains
            ):
                await load(resolved)

    for path in fragment_paths:
        await load(path)

    return result
```

---

## Prompt Construction: GUIDELINES vs CASE

The resolved knowledge tree is always presented to the LLM in a structured prompt that separates guidelines from the specific case being worked on:

```python
def build_agent_prompt(
    knowledge_tree: dict[str, dict],
    run_state: dict,
    run_context_files: list[dict],
    input_mapping: dict,
) -> tuple[str, str]:
    """Returns (system_prompt, user_prompt)."""

    # Build guidelines section — ordered: root/shared first, then domain files
    universal = [v for k, v in knowledge_tree.items() if is_universal(k)]
    domain    = [v for k, v in knowledge_tree.items() if not is_universal(k)]
    ordered   = universal + domain

    guidelines = "\n\n---\n\n".join(
        f"## {item['domain'].upper()} — {item['path']}\n\n{item['content']}"
        for item in ordered
    )

    system_prompt = f"=== GUIDELINES (how to work) ===\n\n{guidelines}"

    # Build case section — run state fields + attached file metadata
    case_data = extract_input(run_state, input_mapping)
    case_files = "\n\n".join(
        f"[File: {f['filename']}] ({f['mime_type']}, {f['size']} bytes)"
        for f in run_context_files
    )

    user_prompt = (
        f"=== THIS CASE (what you are working on) ===\n\n"
        f"{json.dumps(case_data, indent=2)}\n\n"
        f"{case_files}"
    ).strip()

    return system_prompt, user_prompt
```

The LLM always knows: guidelines describe how to work; the case is what it is working on. File bytes are not inlined in prompts. For OpenClaw, Knotwork forwards attachment URLs in the execution task so OpenClaw handles file retrieval/processing itself.

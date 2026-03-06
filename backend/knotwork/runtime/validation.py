"""
Graph topology validation.

validate_graph() performs a BFS reachability check:
- Every non-start/end node must be reachable from a start node (forward BFS).
- Every non-start/end node must reach an end node (backward BFS).

All graphs with work nodes must have Start and End nodes wired up.
"""
from __future__ import annotations

# Keep in sync with frontend src/utils/models.ts
VALID_MODELS: frozenset[str] = frozenset({
    # With provider prefix
    "openai/gpt-4o", "openai/gpt-4o-mini", "openai/gpt-4-turbo", "openai/gpt-3.5-turbo",
    "anthropic/claude-opus-4-6", "anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5-20251001",
    # Without prefix
    "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo",
    "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001",
})


def validate_graph(definition: dict) -> list[str]:
    """
    Validate graph topology. Returns a list of error strings.
    Empty list means valid.

    All graphs with work nodes must have Start and End nodes wired up.
    """
    nodes = definition.get("nodes", [])
    edges = definition.get("edges", [])

    if not nodes:
        return []

    node_ids = {n["id"] for n in nodes}
    start_ids = {n["id"] for n in nodes if n.get("type") == "start"}
    end_ids = {n["id"] for n in nodes if n.get("type") == "end"}

    work_ids = node_ids - start_ids - end_ids
    if not work_ids:
        return []  # Only start/end with no work nodes — valid

    # All graphs with work nodes require Start and End
    if not start_ids:
        return ["Add a Start node and connect it to begin the workflow"]
    if not end_ids:
        return ["Add an End node and connect your last node to it"]

    # Build adjacency maps
    fwd: dict[str, set[str]] = {nid: set() for nid in node_ids}
    bwd: dict[str, set[str]] = {nid: set() for nid in node_ids}
    for edge in edges:
        src, tgt = edge.get("source"), edge.get("target")
        if src in node_ids and tgt in node_ids:
            fwd[src].add(tgt)
            bwd[tgt].add(src)

    def bfs(start_set: set[str], adj: dict[str, set[str]]) -> set[str]:
        visited: set[str] = set()
        queue = list(start_set)
        while queue:
            cur = queue.pop()
            if cur in visited:
                continue
            visited.add(cur)
            queue.extend(adj.get(cur, set()))
        return visited

    reachable_from_start = bfs(start_ids, fwd) - start_ids
    can_reach_end = bfs(end_ids, bwd) - end_ids

    errors: list[str] = []
    for nid in work_ids:
        node = next((n for n in nodes if n["id"] == nid), {})
        name = node.get("name", nid)
        if nid not in reachable_from_start:
            errors.append(f'Node "{name}" is not reachable from Start')
        elif nid not in can_reach_end:
            errors.append(f'Node "{name}" has no path to End')
        # Model validation for llm_agent nodes
        if node.get("type") == "llm_agent":
            model = (node.get("config") or {}).get("model")
            if model and model not in VALID_MODELS:
                errors.append(f'Node "{name}": unknown model "{model}"')

    return errors

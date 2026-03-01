"""
Graph topology validation.

validate_graph() performs a BFS reachability check:
- Every non-start/end node must be reachable from a start node (forward BFS).
- Every non-start/end node must reach an end node (backward BFS).

Returns [] for legacy graphs that have no start node (backward-compatible).
"""
from __future__ import annotations


def validate_graph(definition: dict) -> list[str]:
    """
    Validate graph topology. Returns a list of error strings.
    Empty list means valid.

    Skips validation entirely for legacy graphs with no 'start' node.
    """
    nodes = definition.get("nodes", [])
    edges = definition.get("edges", [])

    if not nodes:
        return []

    node_ids = {n["id"] for n in nodes}
    start_ids = {n["id"] for n in nodes if n.get("type") == "start"}
    end_ids = {n["id"] for n in nodes if n.get("type") == "end"}

    # Legacy graph — skip validation
    if not start_ids:
        return []

    work_ids = node_ids - start_ids - end_ids
    if not work_ids:
        return []

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
        if nid not in reachable_from_start:
            name = next((n.get("name", nid) for n in nodes if n["id"] == nid), nid)
            errors.append(f'Node "{name}" is not reachable from Start')
        elif nid not in can_reach_end:
            name = next((n.get("name", nid) for n in nodes if n["id"] == nid), nid)
            errors.append(f'Node "{name}" has no path to End')

    return errors

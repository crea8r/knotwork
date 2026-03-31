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
    from knotwork.graphs.schemas import normalize_graph_definition

    definition = normalize_graph_definition(definition)
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

    # Count outgoing edges per source (work nodes only)
    outgoing_count: dict[str, int] = {}
    for edge in edges:
        src = edge.get("source")
        if src in work_ids:
            outgoing_count[src] = outgoing_count.get(src, 0) + 1

    errors: list[str] = []
    for nid in work_ids:
        node = next((n for n in nodes if n["id"] == nid), {})
        name = node.get("name", nid)
        if nid not in reachable_from_start:
            errors.append(f'Node "{name}" is not reachable from Start')
        elif nid not in can_reach_end:
            errors.append(f'Node "{name}" has no path to End')
        if node.get("type") == "agent":
            supervisor_id = str(node.get("supervisor_id") or "").strip()
            if not supervisor_id:
                errors.append(f'Node "{name}" is missing a supervisor')
            operator_id = str(node.get("operator_id") or "").strip()
            registered_agent_id = str(node.get("registered_agent_id") or "").strip()
            operator_agent_id = operator_id or (f"agent:{registered_agent_id}" if registered_agent_id else "")
            if operator_agent_id.startswith("agent:") and supervisor_id == operator_agent_id:
                errors.append(
                    f'Node "{name}" cannot use the same agent as both operator and supervisor'
                )
            model = (node.get("config") or {}).get("model")
            if model and model not in VALID_MODELS:
                errors.append(f'Node "{name}": unknown model "{model}"')

    # Conditional edges must have a condition_label so the agent knows what to evaluate
    if outgoing_count:
        for edge in edges:
            src = edge.get("source")
            if src not in work_ids:
                continue
            if outgoing_count.get(src, 0) > 1 and not edge.get("condition_label"):
                src_node = next((n for n in nodes if n["id"] == src), {})
                tgt_node = next((n for n in nodes if n["id"] == edge.get("target")), {})
                src_name = src_node.get("name", src)
                tgt_name = tgt_node.get("name", edge.get("target", "?"))
                errors.append(
                    f'Edge from "{src_name}" to "{tgt_name}" needs a condition label '
                    f"(the question the agent evaluates to choose this branch)"
                )

    return errors

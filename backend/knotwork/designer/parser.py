"""
Markdown-to-graph parser for the knotwork designer.

Converts a Markdown workflow description into a draft graph definition.

Conventions:
  - ``## Node Name`` headings delimit node sections.
  - ``**Type:** <type>`` inside a section sets the node type.
  - Lines matching ``-> Other Node`` define edges to sibling nodes.
  - The first node defined is the entry point.
  - Node types: llm_agent (default), human_checkpoint, conditional_router, tool_executor.
"""
from __future__ import annotations

import re

_VALID_TYPES = {"llm_agent", "human_checkpoint", "conditional_router", "tool_executor"}


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def parse_md_to_graph(content: str, name: str) -> dict:
    """
    Parse a Markdown workflow description into a draft graph definition.

    Returns a dict matching the GraphDefinition schema:
      {name, entry_point, nodes: [NodeDef], edges: [EdgeDef]}

    Node configs are left empty; the operator fills them in via the node config panel.
    """
    sections = re.split(r"^## ", content, flags=re.MULTILINE)

    nodes: list[dict] = []
    edge_pairs: list[tuple[str, str]] = []   # (source_id, raw_target_name)
    name_to_id: dict[str, str] = {}           # lower(node_name) → node_id
    entry_point: str | None = None

    for section in sections[1:]:
        lines = section.strip().split("\n")
        node_name = lines[0].strip()
        node_id = _slugify(node_name)
        name_to_id[node_name.lower()] = node_id

        # Extract type from **Type:** field, default llm_agent
        node_type = "llm_agent"
        type_match = re.search(r"\*\*Type:\*\*\s*(\w+)", section)
        if type_match and type_match.group(1) in _VALID_TYPES:
            node_type = type_match.group(1)

        nodes.append({"id": node_id, "type": node_type, "name": node_name, "config": {}})
        if entry_point is None:
            entry_point = node_id

        # Collect edge targets declared in this section
        for line in lines[1:]:
            edge_match = re.match(r"\s*->\s*(.+)", line)
            if edge_match:
                edge_pairs.append((node_id, edge_match.group(1).strip()))

    # Resolve edge pairs → EdgeDef dicts
    edges: list[dict] = []
    for source_id, target_raw in edge_pairs:
        target_id = name_to_id.get(target_raw.lower()) or _slugify(target_raw)
        edge_id = f"e-{source_id}-{target_id}"
        edges.append({"id": edge_id, "source": source_id, "target": target_id, "type": "direct"})

    return {
        "name": name,
        "entry_point": entry_point,
        "nodes": nodes,
        "edges": edges,
    }

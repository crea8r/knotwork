"""
Markdown-to-graph parser for the knotwork designer.

Enables operators to import a workflow description written in plain Markdown
and have it converted into a draft graph definition that can then be refined
in the visual designer or via the designer agent.

Expected Markdown conventions
------------------------------
- Level-2 headings (``## Node Name``) delimit node sections.
- A ``**Type:**`` bold field inside a section sets the node type
  (``llm_agent``, ``human_checkpoint``, ``conditional_router``,
  ``tool_executor``).
- Bullet lines starting with ``->`` denote edges to other nodes,
  e.g. ``-> Approval Node``.
- The first node defined is treated as the entry point.
"""

from __future__ import annotations

import re


def parse_md_to_graph(content: str, name: str) -> dict:
    """
    Parse a Markdown workflow description into a draft graph definition.

    The returned graph definition follows the same schema as the
    ``Graph.definition`` JSONB column:

    .. code-block:: python

        {
            "name": "<name>",
            "entry_point": "<node_id>",
            "nodes": [
                {
                    "id": "<slug>",
                    "label": "<heading text>",
                    "type": "<node_type>",
                    "config": {}
                },
                ...
            ],
            "edges": [
                {"from": "<node_id>", "to": "<node_id>"},
                ...
            ]
        }

    Args:
        content: Raw Markdown string to parse.
        name:    Human-readable name to assign to the resulting graph.

    Returns:
        Draft graph definition dict.  Node configs are left empty; the
        operator or designer agent is expected to fill them in.

    Raises:
        NotImplementedError: Always — implementation pending.
    """
    raise NotImplementedError

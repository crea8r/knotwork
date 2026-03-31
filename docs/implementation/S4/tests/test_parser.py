"""
S4 tests: Markdown-to-graph parser.
"""
from __future__ import annotations

import pytest
from knotwork.designer.parser import parse_md_to_graph


def test_empty_content():
    """No headings → empty graph with None entry_point."""
    result = parse_md_to_graph("No headings here.", "Empty")
    assert result["nodes"] == []
    assert result["edges"] == []
    assert result["entry_point"] is None


def test_single_node():
    """One heading → one node; entry_point set to that node."""
    md = "## Contract Review\n\nReview the contract carefully."
    result = parse_md_to_graph(md, "Single")
    assert len(result["nodes"]) == 1
    node = result["nodes"][0]
    assert node["id"] == "contract-review"
    assert node["name"] == "Contract Review"
    assert node["type"] == "agent"  # default
    assert result["entry_point"] == "contract-review"


def test_node_type_extraction():
    """Legacy type markers now collapse to the unified agent type."""
    md = "## Review Gate\n\n**Type:** human_checkpoint\n\nReviewer must approve."
    result = parse_md_to_graph(md, "Types")
    assert result["nodes"][0]["type"] == "agent"


def test_invalid_type_defaults_to_agent():
    """Unknown type strings fall back to agent."""
    md = "## My Node\n\n**Type:** unknown_type"
    result = parse_md_to_graph(md, "Fallback")
    assert result["nodes"][0]["type"] == "agent"


def test_edge_extraction():
    """Lines starting with -> create edges between nodes."""
    md = "## Analyse\n\n-> Review\n\n## Review\n\n**Type:** human_checkpoint"
    result = parse_md_to_graph(md, "Edges")
    assert len(result["nodes"]) == 2
    assert len(result["edges"]) == 1
    edge = result["edges"][0]
    assert edge["source"] == "analyse"
    assert edge["target"] == "review"
    assert edge["type"] == "direct"


def test_multi_node_entry_point():
    """First node defined is the entry_point."""
    md = "## Step 1\n\n## Step 2\n\n## Step 3"
    result = parse_md_to_graph(md, "Multi")
    assert result["entry_point"] == "step-1"
    assert len(result["nodes"]) == 3


def test_graph_name():
    """Returned graph carries the name parameter."""
    result = parse_md_to_graph("## Node", "My Workflow")
    assert result["name"] == "My Workflow"


def test_slugify_special_chars():
    """Node names with spaces and special chars produce valid slugs."""
    md = "## Risk & Compliance Check!"
    result = parse_md_to_graph(md, "Slug")
    assert result["nodes"][0]["id"] == "risk-compliance-check"


def test_node_config_empty():
    """Parsed nodes always have empty config dicts."""
    md = "## Analyse Input"
    result = parse_md_to_graph(md, "Config")
    assert result["nodes"][0]["config"] == {}


def test_multiple_edges_from_one_node():
    """A node can declare multiple -> edges."""
    md = "## Router\n\n-> Approve\n-> Reject\n\n## Approve\n\n## Reject"
    result = parse_md_to_graph(md, "Multi-edge")
    edge_sources = [e["source"] for e in result["edges"]]
    assert edge_sources.count("router") == 2


def test_all_legacy_node_types_normalize_to_agent():
    """Historical type markers all normalize to the unified agent type."""
    md = "\n".join([
        "## LLM Node\n**Type:** llm_agent",
        "## Gate\n**Type:** human_checkpoint",
        "## Branch\n**Type:** conditional_router",
        "## Tool\n**Type:** tool_executor",
    ])
    result = parse_md_to_graph(md, "All types")
    types = [n["type"] for n in result["nodes"]]
    assert types == ["agent", "agent", "agent", "agent"]

from __future__ import annotations

from modules.workflows.backend.graphs.designer_parser import parse_md_to_graph


def test_empty_content():
    result = parse_md_to_graph("No headings here.", "Empty")
    assert result["nodes"] == []
    assert result["edges"] == []
    assert result["entry_point"] is None


def test_single_node():
    result = parse_md_to_graph("## Contract Review\n\nReview the contract carefully.", "Single")
    assert len(result["nodes"]) == 1
    assert result["nodes"][0]["id"] == "contract-review"
    assert result["nodes"][0]["name"] == "Contract Review"
    assert result["nodes"][0]["type"] == "agent"
    assert result["entry_point"] == "contract-review"


def test_node_type_extraction_normalizes_legacy_marker():
    result = parse_md_to_graph("## Review Gate\n\n**Type:** human_checkpoint\n\nReviewer must approve.", "Types")
    assert result["nodes"][0]["type"] == "agent"


def test_invalid_type_defaults_to_agent():
    result = parse_md_to_graph("## My Node\n\n**Type:** unknown_type", "Fallback")
    assert result["nodes"][0]["type"] == "agent"


def test_edge_extraction():
    result = parse_md_to_graph("## Analyse\n\n-> Review\n\n## Review\n\n**Type:** human_checkpoint", "Edges")
    assert len(result["nodes"]) == 2
    assert len(result["edges"]) == 1
    assert result["edges"][0]["source"] == "analyse"
    assert result["edges"][0]["target"] == "review"
    assert result["edges"][0]["type"] == "direct"


def test_multi_node_entry_point():
    result = parse_md_to_graph("## Step 1\n\n## Step 2\n\n## Step 3", "Multi")
    assert result["entry_point"] == "step-1"
    assert len(result["nodes"]) == 3


def test_graph_name():
    assert parse_md_to_graph("## Node", "My Workflow")["name"] == "My Workflow"


def test_slugify_special_chars():
    result = parse_md_to_graph("## Risk & Compliance Check!", "Slug")
    assert result["nodes"][0]["id"] == "risk-compliance-check"


def test_node_config_empty():
    result = parse_md_to_graph("## Analyse Input", "Config")
    assert result["nodes"][0]["config"] == {}


def test_multiple_edges_from_one_node():
    result = parse_md_to_graph("## Router\n\n-> Approve\n-> Reject\n\n## Approve\n\n## Reject", "Multi-edge")
    assert [edge["source"] for edge in result["edges"]].count("router") == 2


def test_all_legacy_node_types_normalize_to_agent():
    content = "\n".join(
        [
            "## LLM Node\n**Type:** llm_agent",
            "## Gate\n**Type:** human_checkpoint",
            "## Branch\n**Type:** conditional_router",
            "## Tool\n**Type:** tool_executor",
        ]
    )
    result = parse_md_to_graph(content, "All types")
    assert [node["type"] for node in result["nodes"]] == ["agent", "agent", "agent", "agent"]

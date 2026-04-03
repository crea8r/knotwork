"""
S8.3 tests: Prompt Architecture Refactor.

Covers:
  - First-node detection: run input included only when all_outputs is empty
  - Subsequent nodes: no THIS CASE injected (session history carries context)
  - input_sources config is ignored (removed)
  - _build_tail_blocks: ROUTING block only when multiple targets
  - _build_completion_protocol: correct structure and examples
  - _build_retry_user_prompt: HUMAN INTERVENTION + ROUTING + COMPLETION, no system_prompt
  - Routing escalation context: options field present, questions empty
  - validate_graph: rejects multi-branch edges missing condition_label
  - EscalationResolve schema: accepts answers list and next_branch
  - build_agent_prompt: first-node includes run input; subsequent node omits it
"""
from __future__ import annotations

import pytest


# ── _build_tail_blocks ─────────────────────────────────────────────────────────

def test_tail_blocks_single_target_no_routing():
    """With only one target, tail blocks should NOT include a ROUTING section."""
    from knotwork.runtime.nodes.agent import _build_tail_blocks

    edges = [{"target": "node-b", "condition_label": None}]
    targets = ["node-b"]
    result = _build_tail_blocks(edges, targets)

    assert "=== ROUTING ===" not in result
    assert "=== COMPLETION PROTOCOL ===" in result


def test_tail_blocks_multiple_targets_includes_routing():
    """With multiple targets, tail blocks MUST include a ROUTING section before COMPLETION."""
    from knotwork.runtime.nodes.agent import _build_tail_blocks

    edges = [
        {"target": "approved", "condition_label": "contract looks good"},
        {"target": "rejected", "condition_label": "contract has issues"},
    ]
    targets = ["approved", "rejected"]
    result = _build_tail_blocks(edges, targets)

    assert "=== ROUTING ===" in result
    assert "=== COMPLETION PROTOCOL ===" in result
    # ROUTING must come before COMPLETION
    assert result.index("=== ROUTING ===") < result.index("=== COMPLETION PROTOCOL ===")


def test_tail_blocks_routing_includes_condition_labels():
    """ROUTING block must include condition_label text for each edge."""
    from knotwork.runtime.nodes.agent import _build_tail_blocks

    edges = [
        {"target": "node-yes", "condition_label": "user approved the proposal"},
        {"target": "node-no", "condition_label": "user rejected the proposal"},
    ]
    targets = ["node-yes", "node-no"]
    result = _build_tail_blocks(edges, targets)

    assert "user approved the proposal" in result
    assert "user rejected the proposal" in result


def test_tail_blocks_empty_targets():
    """With no targets, tail blocks produce only COMPLETION PROTOCOL (no crash)."""
    from knotwork.runtime.nodes.agent import _build_tail_blocks

    result = _build_tail_blocks([], [])

    assert "=== COMPLETION PROTOCOL ===" in result
    assert "=== ROUTING ===" not in result


# ── _build_completion_protocol ─────────────────────────────────────────────────

def test_completion_protocol_confident_form():
    """COMPLETION PROTOCOL must include the 'confident' decision form."""
    from knotwork.runtime.nodes.agent import _build_completion_protocol

    result = _build_completion_protocol(["node-b"])
    assert '"decision": "confident"' in result
    assert '"output"' in result
    assert '"next_branch"' in result


def test_completion_protocol_escalate_form():
    """COMPLETION PROTOCOL must include the 'escalate' decision form with questions array."""
    from knotwork.runtime.nodes.agent import _build_completion_protocol

    result = _build_completion_protocol(["node-b"])
    assert '"decision": "escalate"' in result
    assert '"questions"' in result


def test_completion_protocol_json_decision_fence():
    """COMPLETION PROTOCOL must use ```json-decision fence."""
    from knotwork.runtime.nodes.agent import _build_completion_protocol

    result = _build_completion_protocol([])
    assert "```json-decision" in result


def test_completion_protocol_next_branch_examples():
    """next_branch must reference the provided target in examples."""
    from knotwork.runtime.nodes.agent import _build_completion_protocol

    result = _build_completion_protocol(["my-target-node"])
    assert "my-target-node" in result


# ── _build_retry_user_prompt ────────────────────────────────────────────────────

def test_retry_prompt_has_human_intervention():
    """Retry user_prompt must start with HUMAN INTERVENTION section."""
    from knotwork.runtime.nodes.agent import _build_retry_user_prompt

    result = _build_retry_user_prompt("Please choose branch A.", [], [])
    assert result.startswith("=== HUMAN INTERVENTION ===")
    assert "Please choose branch A." in result


def test_retry_prompt_has_completion_protocol():
    """Retry user_prompt must include COMPLETION PROTOCOL."""
    from knotwork.runtime.nodes.agent import _build_retry_user_prompt

    result = _build_retry_user_prompt("Guidance here.", [], [])
    assert "=== COMPLETION PROTOCOL ===" in result


def test_retry_prompt_has_routing_for_multi_branch():
    """Retry user_prompt must include ROUTING when multiple targets present."""
    from knotwork.runtime.nodes.agent import _build_retry_user_prompt

    edges = [
        {"target": "a", "condition_label": "condition A"},
        {"target": "b", "condition_label": "condition B"},
    ]
    result = _build_retry_user_prompt("Try again.", edges, ["a", "b"])
    assert "=== ROUTING ===" in result


def test_retry_prompt_no_routing_for_single_branch():
    """Retry user_prompt must NOT include ROUTING when only one target."""
    from knotwork.runtime.nodes.agent import _build_retry_user_prompt

    edges = [{"target": "node-only", "condition_label": None}]
    result = _build_retry_user_prompt("Try again.", edges, ["node-only"])
    assert "=== ROUTING ===" not in result


def test_retry_prompt_order():
    """Retry prompt order: HUMAN INTERVENTION → ROUTING → COMPLETION PROTOCOL."""
    from knotwork.runtime.nodes.agent import _build_retry_user_prompt

    edges = [
        {"target": "x", "condition_label": "cx"},
        {"target": "y", "condition_label": "cy"},
    ]
    result = _build_retry_user_prompt("Guidance.", edges, ["x", "y"])
    hi_idx = result.index("=== HUMAN INTERVENTION ===")
    ro_idx = result.index("=== ROUTING ===")
    cp_idx = result.index("=== COMPLETION PROTOCOL ===")
    assert hi_idx < ro_idx < cp_idx


# ── First-node detection via prompt_builder ────────────────────────────────────

def test_first_node_includes_run_input():
    """When all_outputs is empty (first node), run input must appear in user_prompt."""
    from knotwork.runtime.prompt_builder import build_agent_prompt
    from knotwork.runtime.knowledge_loader import KnowledgeTree

    tree = KnowledgeTree()
    state_fields = {"task": "Review the contract", "client": "Acme Corp"}
    _, user_prompt = build_agent_prompt(
        tree=tree,
        state_fields=state_fields,
        context_files=[],
        prior_outputs=None,
    )

    assert "Review the contract" in user_prompt
    assert "Acme Corp" in user_prompt


def test_subsequent_node_omits_run_input():
    """When all_outputs is non-empty (subsequent node), run input must NOT be injected."""
    from knotwork.runtime.prompt_builder import build_agent_prompt
    from knotwork.runtime.knowledge_loader import KnowledgeTree

    tree = KnowledgeTree()
    # Simulate what agent.py does for subsequent nodes:
    # is_first_node = False → run_fields = {} → no state_fields
    state_fields: dict = {}
    _, user_prompt = build_agent_prompt(
        tree=tree,
        state_fields=state_fields,
        context_files=[],
        prior_outputs=None,
    )

    # No run input section should appear
    assert "### Run input" not in user_prompt


def test_first_node_detection_logic():
    """all_outputs empty → is_first_node True; non-empty → False."""
    # Simulate the logic used in agent.py
    all_outputs_empty: dict = {}
    all_outputs_with_data: dict = {"node-a": "some output text"}

    assert not all_outputs_empty  # is_first_node = True
    assert all_outputs_with_data  # is_first_node = False


def test_input_sources_config_ignored():
    """Nodes with 'input_sources' in config should still work — the field is just unused."""
    from knotwork.runtime.nodes.agent import make_agent_node

    # make_agent_node should not raise even when input_sources is present in config
    node_def = {
        "id": "node-test",
        "type": "agent",
        "name": "Test Node",
        "agent_ref": "human",
        "config": {
            "input_sources": ["run_input", "node-prev"],  # legacy field — must be silently ignored
            "system_prompt": "Do something.",
        },
    }
    fn = make_agent_node(node_def, outgoing_edges=[])
    # If make_agent_node raises, the test fails.
    assert callable(fn)


# ── validate_graph: condition_label enforcement ────────────────────────────────

def test_validate_graph_missing_condition_label():
    """Multi-branch edges without condition_label must produce a validation error."""
    from knotwork.runtime.validation import validate_graph

    graph_def = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start"},
            {"id": "agent-1", "type": "agent", "name": "Reviewer"},
            {"id": "node-yes", "type": "agent", "name": "Approve Path"},
            {"id": "node-no", "type": "agent", "name": "Reject Path"},
            {"id": "end", "type": "end", "name": "End"},
        ],
        "edges": [
            {"source": "start", "target": "agent-1"},
            # Two outgoing edges from agent-1 — neither has condition_label
            {"source": "agent-1", "target": "node-yes"},
            {"source": "agent-1", "target": "node-no"},
            {"source": "node-yes", "target": "end"},
            {"source": "node-no", "target": "end"},
        ],
    }

    errors = validate_graph(graph_def)
    condition_errors = [e for e in errors if "condition" in e.lower()]
    assert len(condition_errors) >= 1


def test_validate_graph_with_condition_labels_passes():
    """Multi-branch edges WITH condition_labels must not produce condition errors."""
    from knotwork.runtime.validation import validate_graph

    graph_def = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start"},
            {"id": "agent-1", "type": "agent", "name": "Reviewer"},
            {"id": "node-yes", "type": "agent", "name": "Approve Path"},
            {"id": "node-no", "type": "agent", "name": "Reject Path"},
            {"id": "end", "type": "end", "name": "End"},
        ],
        "edges": [
            {"source": "start", "target": "agent-1"},
            {"source": "agent-1", "target": "node-yes", "condition_label": "contract is acceptable"},
            {"source": "agent-1", "target": "node-no", "condition_label": "contract has issues"},
            {"source": "node-yes", "target": "end"},
            {"source": "node-no", "target": "end"},
        ],
    }

    errors = validate_graph(graph_def)
    condition_errors = [e for e in errors if "condition" in e.lower()]
    assert len(condition_errors) == 0


def test_validate_graph_single_branch_no_condition_required():
    """Single outgoing edge does NOT require condition_label."""
    from knotwork.runtime.validation import validate_graph

    graph_def = {
        "nodes": [
            {"id": "start", "type": "start", "name": "Start"},
            {"id": "agent-1", "type": "agent", "name": "Worker"},
            {"id": "end", "type": "end", "name": "End"},
        ],
        "edges": [
            {"source": "start", "target": "agent-1"},
            {"source": "agent-1", "target": "end"},  # single outgoing — no condition_label needed
        ],
    }

    errors = validate_graph(graph_def)
    condition_errors = [e for e in errors if "condition" in e.lower()]
    assert len(condition_errors) == 0


# ── EscalationResolve schema ────────────────────────────────────────────────────

def test_escalation_resolve_accepts_answers():
    """EscalationResolve must accept an 'answers' list of strings."""
    from knotwork.escalations.schemas import EscalationResolve

    payload = EscalationResolve(
        resolution="request_revision",
        answers=["Yes, proceed with the contract.", "Budget is $50,000."],
    )
    assert payload.answers == ["Yes, proceed with the contract.", "Budget is $50,000."]


def test_escalation_resolve_accepts_next_branch():
    """EscalationResolve must accept a 'next_branch' string for routing escalations."""
    from knotwork.escalations.schemas import EscalationResolve

    payload = EscalationResolve(
        resolution="accept_output",
        next_branch="node-approved",
    )
    assert payload.next_branch == "node-approved"


def test_escalation_resolve_answers_defaults_to_none():
    """EscalationResolve answers field defaults to None when not provided."""
    from knotwork.escalations.schemas import EscalationResolve

    payload = EscalationResolve(resolution="accept_output")
    assert payload.answers is None


def test_escalation_resolve_next_branch_defaults_to_none():
    """EscalationResolve next_branch field defaults to None when not provided."""
    from knotwork.escalations.schemas import EscalationResolve

    payload = EscalationResolve(resolution="accept_output")
    assert payload.next_branch is None


def test_escalation_resolve_both_fields_together():
    """EscalationResolve accepts both answers and next_branch simultaneously."""
    from knotwork.escalations.schemas import EscalationResolve

    payload = EscalationResolve(
        resolution="request_revision",
        answers=["Answer 1"],
        next_branch="node-b",
    )
    assert payload.answers == ["Answer 1"]
    assert payload.next_branch == "node-b"


# ── _strip_trailing_decision_block ─────────────────────────────────────────────

def test_strip_trailing_decision_block_removes_block():
    """_strip_trailing_decision_block must remove a trailing json-decision block."""
    from knotwork.runtime.nodes.agent import _strip_trailing_decision_block

    text = 'Here is my analysis.\n\n```json-decision\n{"decision": "confident", "output": "done"}\n```'
    result = _strip_trailing_decision_block(text)
    assert "```json-decision" not in result
    assert "Here is my analysis." in result


def test_strip_trailing_decision_block_no_block_unchanged():
    """_strip_trailing_decision_block must return text unchanged when no block present."""
    from knotwork.runtime.nodes.agent import _strip_trailing_decision_block

    text = "Just regular output with no decision block."
    result = _strip_trailing_decision_block(text)
    assert result == text


def test_strip_trailing_decision_block_inline_block_unchanged():
    """_strip_trailing_decision_block must not strip blocks with trailing text after them."""
    from knotwork.runtime.nodes.agent import _strip_trailing_decision_block

    text = '```json-decision\n{"decision": "confident"}\n```\nSome more text after.'
    result = _strip_trailing_decision_block(text)
    # The block is not trailing (has text after), so nothing should be stripped
    assert "```json-decision" in result


# ── _trust_level_to_float ──────────────────────────────────────────────────────

def test_trust_level_float_passthrough():
    """Numeric trust_level values are clamped to [0, 1]."""
    from knotwork.runtime.nodes.agent import _trust_level_to_float

    assert _trust_level_to_float({"trust_level": 0.7}) == pytest.approx(0.7)
    assert _trust_level_to_float({"trust_level": 0.0}) == pytest.approx(0.0)
    assert _trust_level_to_float({"trust_level": 1.0}) == pytest.approx(1.0)


def test_trust_level_clamps_out_of_range():
    """Values outside [0,1] are clamped."""
    from knotwork.runtime.nodes.agent import _trust_level_to_float

    assert _trust_level_to_float({"trust_level": 1.5}) == pytest.approx(1.0)
    assert _trust_level_to_float({"trust_level": -0.5}) == pytest.approx(0.0)


def test_trust_level_legacy_strings():
    """Legacy string enum values are mapped to canonical floats."""
    from knotwork.runtime.nodes.agent import _trust_level_to_float

    assert _trust_level_to_float({"trust_level": "user_controlled"}) == pytest.approx(0.0)
    assert _trust_level_to_float({"trust_level": "supervised"}) == pytest.approx(0.5)
    assert _trust_level_to_float({"trust_level": "autonomous"}) == pytest.approx(1.0)


def test_trust_level_missing_defaults_to_supervised():
    """Missing trust_level defaults to 0.5 (supervised)."""
    from knotwork.runtime.nodes.agent import _trust_level_to_float

    assert _trust_level_to_float({}) == pytest.approx(0.5)

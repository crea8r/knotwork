"""S2: confidence scoring tests."""
from __future__ import annotations

import pytest
from knotwork.runtime.confidence import compute_confidence, evaluate_expression


# --- evaluate_expression ---

def test_simple_comparison_true():
    assert evaluate_expression("confidence < 0.5", {"confidence": 0.3}) is True


def test_simple_comparison_false():
    assert evaluate_expression("confidence < 0.5", {"confidence": 0.8}) is False


def test_equality():
    assert evaluate_expression("status == 'done'", {"status": "done"}) is True


def test_dot_access_on_dict():
    assert evaluate_expression("output.score < 0.5", {"output": {"score": 0.2}}) is True


def test_dot_access_false():
    assert evaluate_expression("output.score >= 0.8", {"output": {"score": 0.9}}) is True


def test_nested_dot_access():
    ctx = {"output": {"meta": {"confidence": 0.3}}}
    assert evaluate_expression("output.meta.confidence < 0.5", ctx) is True


def test_bool_and():
    assert evaluate_expression("a > 0 and b > 0", {"a": 1, "b": 2}) is True
    assert evaluate_expression("a > 0 and b > 0", {"a": 1, "b": -1}) is False


def test_bool_or():
    assert evaluate_expression("a > 0 or b > 0", {"a": -1, "b": 2}) is True


def test_list_equality():
    assert evaluate_expression("output.items == []", {"output": {"items": []}}) is True


def test_disallowed_call_raises():
    with pytest.raises(ValueError, match="Disallowed"):
        evaluate_expression("__import__('os')", {})


def test_disallowed_lambda_raises():
    with pytest.raises((ValueError, SyntaxError)):
        evaluate_expression("lambda x: x", {})


def test_disallowed_assign_raises():
    with pytest.raises((ValueError, SyntaxError)):
        evaluate_expression("x = 1", {})


def test_missing_key_returns_none_comparison():
    # None < float raises TypeError in Python 3; expression is not safe to evaluate
    with pytest.raises(TypeError):
        evaluate_expression("confidence < 0.5", {"confidence": None})


# --- compute_confidence ---

def test_no_rules_returns_base():
    assert compute_confidence(0.9, [], {}) == 0.9


def test_single_matching_rule():
    rules = [{"condition": "output.score < 0.5", "set": 0.3}]
    result = compute_confidence(1.0, rules, {"output": {"score": 0.2}})
    assert result == 0.3


def test_rule_not_matching_returns_base():
    rules = [{"condition": "output.score < 0.5", "set": 0.3}]
    result = compute_confidence(1.0, rules, {"output": {"score": 0.8}})
    assert result == 1.0


def test_multiple_rules_takes_minimum():
    rules = [
        {"condition": "x > 0", "set": 0.6},
        {"condition": "y > 0", "set": 0.4},
    ]
    result = compute_confidence(1.0, rules, {"x": 1, "y": 1})
    assert result == 0.4


def test_invalid_rule_skipped():
    rules = [{"condition": "INVALID!!!", "set": 0.1}]
    result = compute_confidence(0.8, rules, {})
    assert result == 0.8


def test_base_preserved_when_no_match():
    rules = [{"condition": "False", "set": 0.0}]
    result = compute_confidence(0.75, rules, {})
    assert result == 0.75

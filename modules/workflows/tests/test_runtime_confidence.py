from __future__ import annotations

import pytest

from modules.workflows.backend.runtime.confidence import compute_confidence, evaluate_expression


def test_simple_comparison_true():
    assert evaluate_expression("confidence < 0.5", {"confidence": 0.3}) is True


def test_simple_comparison_false():
    assert evaluate_expression("confidence < 0.5", {"confidence": 0.8}) is False


def test_equality():
    assert evaluate_expression("status == 'done'", {"status": "done"}) is True


def test_dot_access_on_dict():
    assert evaluate_expression("output.score < 0.5", {"output": {"score": 0.2}}) is True


def test_dot_access_true_for_gte():
    assert evaluate_expression("output.score >= 0.8", {"output": {"score": 0.9}}) is True


def test_nested_dot_access():
    assert evaluate_expression(
        "output.meta.confidence < 0.5",
        {"output": {"meta": {"confidence": 0.3}}},
    ) is True


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
    with pytest.raises(TypeError):
        evaluate_expression("confidence < 0.5", {"confidence": None})


def test_no_rules_returns_base():
    assert compute_confidence(0.9, [], {}) == 0.9


def test_single_matching_rule():
    result = compute_confidence(1.0, [{"condition": "output.score < 0.5", "set": 0.3}], {"output": {"score": 0.2}})
    assert result == 0.3


def test_rule_not_matching_returns_base():
    result = compute_confidence(1.0, [{"condition": "output.score < 0.5", "set": 0.3}], {"output": {"score": 0.8}})
    assert result == 1.0


def test_multiple_rules_takes_minimum():
    rules = [{"condition": "x > 0", "set": 0.6}, {"condition": "y > 0", "set": 0.4}]
    assert compute_confidence(1.0, rules, {"x": 1, "y": 1}) == 0.4


def test_invalid_rule_skipped():
    assert compute_confidence(0.8, [{"condition": "INVALID!!!", "set": 0.1}], {}) == 0.8


def test_base_preserved_when_no_match():
    assert compute_confidence(0.75, [{"condition": "False", "set": 0.0}], {}) == 0.75

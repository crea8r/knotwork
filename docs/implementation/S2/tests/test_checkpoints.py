"""S2: checkpoint evaluation tests."""
from __future__ import annotations

from knotwork.runtime.checkpoints import evaluate_checkpoints


PASS_CP = {
    "id": "cp1",
    "name": "Score check",
    "type": "expression",
    "expression": "output.score >= 0.8",
    "fail_message": "Score too low",
}

FAIL_CP = {
    "id": "cp2",
    "name": "Non-empty check",
    "type": "expression",
    "expression": "output.text != ''",
    "fail_message": "Empty text",
}

HUMAN_CP = {
    "id": "cp3",
    "name": "Human review",
    "type": "human",
    "fail_message": "Needs human",
}


def test_empty_list_passes():
    assert evaluate_checkpoints([], {"text": "hello"}) == []


def test_passing_checkpoint():
    result = evaluate_checkpoints([PASS_CP], {"score": 0.9})
    assert result == []


def test_failing_checkpoint():
    result = evaluate_checkpoints([FAIL_CP], {"text": ""})
    assert len(result) == 1
    assert result[0]["id"] == "cp2"


def test_human_checkpoint_skipped():
    result = evaluate_checkpoints([HUMAN_CP], {})
    assert result == []


def test_mix_pass_fail():
    output = {"score": 0.9, "text": ""}
    result = evaluate_checkpoints([PASS_CP, FAIL_CP], output)
    assert len(result) == 1
    assert result[0]["id"] == "cp2"


def test_all_fail():
    output = {"score": 0.3, "text": ""}
    result = evaluate_checkpoints([PASS_CP, FAIL_CP], output)
    assert len(result) == 2


def test_invalid_expression_fails_safe():
    bad_cp = {"id": "bad", "type": "expression", "expression": "INVALID%%%", "fail_message": ""}
    result = evaluate_checkpoints([bad_cp], {})
    assert len(result) == 1
    assert result[0]["id"] == "bad"


def test_empty_expression_fails_safe():
    empty_cp = {"id": "empty", "type": "expression", "expression": "", "fail_message": ""}
    result = evaluate_checkpoints([empty_cp], {})
    assert len(result) == 1


def test_human_among_expressions():
    cps = [PASS_CP, HUMAN_CP, FAIL_CP]
    output = {"score": 0.95, "text": ""}
    result = evaluate_checkpoints(cps, output)
    assert len(result) == 1
    assert result[0]["id"] == "cp2"

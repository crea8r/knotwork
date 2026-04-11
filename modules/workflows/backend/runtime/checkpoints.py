"""
Checkpoint evaluation for LLM node outputs.

Checkpoints are declarative assertions that must hold before a node's output
is accepted.  Any checkpoint that fails is returned so the caller can decide
whether to escalate, retry, or halt the run.

Checkpoint schema
-----------------
Each checkpoint dict has the following shape::

    {
        "id":           "<uuid>",
        "name":         "<human-readable label>",
        "type":         "expression" | "human",   # only "expression" evaluated here
        "expression":   "<boolean expression string>",
        "fail_message": "<message shown when checkpoint fails>"
    }
"""

from __future__ import annotations

from .confidence import evaluate_expression


def evaluate_checkpoints(
    checkpoints: list[dict],
    output: dict,
) -> list[dict]:
    """
    Evaluate a list of checkpoints against a node's output.

    For each checkpoint whose ``type`` is ``"expression"``, the ``expression``
    field is evaluated against ``{"output": output}``.  Checkpoints of type
    ``"human"`` are skipped — they are handled by the human-checkpoint node.

    Returns:
        A (possibly empty) list containing only the checkpoint dicts that
        *failed* evaluation.  An empty return value means all checkpoints passed.
    """
    failed: list[dict] = []
    for cp in checkpoints:
        cp_type = cp.get("type", "expression")
        if cp_type == "human":
            continue

        expression = cp.get("expression", "")
        if not expression:
            failed.append(cp)
            continue

        try:
            passed = evaluate_expression(expression, {"output": output})
            if not passed:
                failed.append(cp)
        except Exception:
            # Invalid / unevaluatable expression → fail safe
            failed.append(cp)

    return failed

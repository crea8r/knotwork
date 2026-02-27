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


def evaluate_checkpoints(
    checkpoints: list[dict],
    output: dict,
) -> list[dict]:
    """
    Evaluate a list of checkpoints against a node's output.

    For each checkpoint whose ``type`` is ``"expression"``, the ``expression``
    field is evaluated against ``output`` using the same expression evaluator
    as :func:`knotwork.runtime.confidence.evaluate_expression`.  Checkpoints
    of other types (e.g. ``"human"``) are skipped here — they are handled by
    the human-checkpoint node.

    Args:
        checkpoints: List of checkpoint definition dicts.  Unknown keys are
                     ignored for forward compatibility.
        output:      The LLM node's output dict used as the expression context.

    Returns:
        A (possibly empty) list containing only the checkpoint dicts that
        *failed* evaluation.  An empty return value means all checkpoints
        passed.

    Raises:
        NotImplementedError: Always — implementation pending.
    """
    raise NotImplementedError

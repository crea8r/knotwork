"""
Confidence scoring utilities for LLM node outputs.

Confidence is a float in [0.0, 1.0] that expresses how reliable a node's
output is before it is written to persistent state or acted upon downstream.

Rule schema
-----------
Each rule in the ``rules`` list has the following shape::

    {
        "condition": "<expression string>",  # evaluated against ``output``
        "set": <float>                        # override value if condition is True
    }

The final score is the minimum of all values set by matching rules, or the
``structured_score`` when no rules match.
"""

from __future__ import annotations


def evaluate_expression(expression: str, context: dict) -> bool:
    """
    Evaluate a simple boolean expression string against a context dictionary.

    The expression may reference keys in ``context`` using Python-style
    attribute/index notation.  Only a safe subset of Python is permitted —
    arbitrary code execution must not be possible.

    Args:
        expression: A boolean expression string, e.g. ``"confidence < 0.5"``
                    or ``"output.tool_calls == []"``.
        context:    Variable bindings available during evaluation.

    Returns:
        ``True`` if the expression evaluates to a truthy value, ``False``
        otherwise.

    Raises:
        NotImplementedError: Always — implementation pending.
    """
    raise NotImplementedError


def compute_confidence(
    structured_score: float,
    rules: list[dict],
    output: dict,
) -> float:
    """
    Compute the final confidence score by applying override rules to a base score.

    The algorithm:
      1. Start with ``structured_score`` as the candidate value.
      2. Evaluate each rule's ``condition`` against ``output`` using
         :func:`evaluate_expression`.
      3. Collect the ``set`` value from every matching rule.
      4. Return the minimum of all collected values, or ``structured_score``
         when no rules match.

    Args:
        structured_score: Base confidence value produced by the LLM node
                          (e.g. derived from a structured output field).
        rules:            Ordered list of rule dicts with ``condition`` and
                          ``set`` keys.
        output:           The node's raw output dict used as the expression
                          evaluation context.

    Returns:
        Final confidence float in [0.0, 1.0].

    Raises:
        NotImplementedError: Always — implementation pending.
    """
    raise NotImplementedError

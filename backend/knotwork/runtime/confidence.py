"""
Confidence scoring utilities for LLM node outputs.

Confidence is a float in [0.0, 1.0] that expresses how reliable a node's
output is before it is written to persistent state or acted upon downstream.

Rule schema
-----------
Each rule in the ``rules`` list has the following shape::

    {
        "condition": "<expression string>",  # evaluated against ``context``
        "set": <float>                        # override value if condition is True
    }

The final score is the minimum of all values set by matching rules, or the
``base`` when no rules match.
"""

from __future__ import annotations

import ast


class _DotDict:
    """Wrap a dict to allow attribute-style access in expressions."""

    def __init__(self, d: dict) -> None:
        object.__setattr__(self, "_d", d)

    def __getattr__(self, name: str):  # type: ignore[override]
        val = object.__getattribute__(self, "_d").get(name)
        if isinstance(val, dict):
            return _DotDict(val)
        return val

    def __eq__(self, other: object) -> bool:
        d = object.__getattribute__(self, "_d")
        if isinstance(other, _DotDict):
            return d == object.__getattribute__(other, "_d")
        return d == other

    def __repr__(self) -> str:
        return repr(object.__getattribute__(self, "_d"))

    def __len__(self) -> int:
        return len(object.__getattribute__(self, "_d"))

    def __iter__(self):
        return iter(object.__getattribute__(self, "_d"))

    def __contains__(self, item: object) -> bool:
        return item in object.__getattribute__(self, "_d")


# Safe subset of AST nodes allowed in expressions
_ALLOWED: set[type] = {
    ast.Expression,
    ast.BoolOp, ast.And, ast.Or,
    ast.UnaryOp, ast.Not, ast.Invert, ast.UAdd, ast.USub,
    ast.Compare,
    ast.BinOp, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod, ast.FloorDiv,
    ast.Name, ast.Load,
    ast.Constant,
    ast.Attribute,
    ast.Subscript, ast.Slice,
    ast.List, ast.Tuple,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
    ast.Is, ast.IsNot, ast.In, ast.NotIn,
}
# Python <3.9 compat
if hasattr(ast, "Index"):
    _ALLOWED.add(ast.Index)  # type: ignore[attr-defined]


def evaluate_expression(expression: str, context: dict) -> bool:
    """
    Evaluate a simple boolean expression string against a context dictionary.

    Only a safe subset of Python AST nodes is permitted — arbitrary code
    execution is not possible.

    Raises:
        ValueError: If the expression contains disallowed AST nodes.
    """
    tree = ast.parse(expression.strip(), mode="eval")
    for node in ast.walk(tree):
        if type(node) not in _ALLOWED:
            raise ValueError(f"Disallowed AST node: {type(node).__name__!r}")

    ns: dict = {
        k: _DotDict(v) if isinstance(v, dict) else v
        for k, v in context.items()
    }
    compiled = compile(tree, "<expr>", "eval")
    return bool(eval(compiled, {"__builtins__": {}}, ns))  # noqa: S307


def compute_confidence(
    base: float,
    rules: list[dict],
    context: dict,
) -> float:
    """
    Compute the final confidence score by applying override rules to a base score.

    For each rule whose ``condition`` evaluates to True against ``context``,
    the rule's ``set`` value is collected.  The final score is the minimum of
    all collected values, or ``base`` when no rules match.
    """
    overrides: list[float] = []
    for rule in rules:
        try:
            if evaluate_expression(rule["condition"], context):
                overrides.append(float(rule["set"]))
        except Exception:
            continue  # skip invalid / unevaluatable rules
    return min(overrides) if overrides else base

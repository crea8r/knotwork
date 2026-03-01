"""Built-in safe arithmetic calculator.

Uses Python's ast module — only numeric constants and basic operators allowed.
No imports, no function calls, no attribute access.
"""
from __future__ import annotations

import ast
import operator

from knotwork.tools.builtins import register

_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
}


def _safe_eval(node: ast.AST) -> float:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return float(node.value)
        raise ValueError(f"Non-numeric constant: {node.value!r}")
    if isinstance(node, ast.BinOp):
        op_fn = _OPS.get(type(node.op))
        if op_fn:
            return op_fn(_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp):
        op_fn = _OPS.get(type(node.op))
        if op_fn:
            return op_fn(_safe_eval(node.operand))
    raise ValueError(f"Unsupported expression node: {ast.dump(node)}")


@register(
    slug="calc",
    name="Calculator",
    description="Safely evaluate arithmetic expressions (no imports or function calls).",
    params=[{"name": "expression", "type": "str", "required": True}],
)
async def calc(expression: str) -> dict:
    tree = ast.parse(expression, mode="eval")
    result = _safe_eval(tree.body)
    return {"expression": expression, "result": result}

"""
Conditional router node for the knotwork runtime graph.

The router is used as the ``edge_function`` argument to
``StateGraph.add_conditional_edges``.  It inspects the current state and
returns the ID of the next node to execute.

Routing algorithm
-----------------
The node definition (``state["node_def"]``) contains an ordered list of
conditions::

    [
        {"expression": "<bool expr>", "target": "<node_id>"},
        ...
        {"expression": None, "target": "<node_id>"}   # default / fallback
    ]

Conditions are evaluated in order using
:func:`knotwork.runtime.confidence.evaluate_expression`.  The first condition
whose expression evaluates to ``True`` (or whose expression is ``None``,
acting as the catch-all default) determines the returned target node ID.
"""

from __future__ import annotations


def conditional_router_node(state: dict, config: dict) -> str:
    """
    Determine the next node ID by evaluating ordered routing conditions.

    Args:
        state:  Current LangGraph state dict.  Must contain ``node_def``
                with a ``conditions`` list and an optional ``default_target``
                fallback node ID.
        config: LangGraph ``RunnableConfig`` (unused by this node but
                required by the LangGraph calling convention).

    Returns:
        The string node ID of the next node to execute.

    Raises:
        NotImplementedError: Always — implementation pending.
    """
    raise NotImplementedError

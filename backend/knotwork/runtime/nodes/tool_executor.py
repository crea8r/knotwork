"""
Tool executor node for the knotwork runtime graph.

Invokes an external tool (HTTP, MCP, or built-in) as part of the graph
execution flow.  Tool definitions are stored in the database and referenced
by ID in the node definition.

Execution steps
---------------
1. Load the ``Tool`` record from the database using the tool ID in
   ``state["node_def"]["tool_id"]``.
2. Map input values from the current state using the input mapping
   configuration (``node_def["input_map"]``), which describes how to extract
   values from state keys and bind them to tool parameters.
3. Invoke the tool (HTTP request, MCP call, etc.).
4. Map the tool's response back onto the state using
   ``node_def["output_map"]``.
5. Return the updated state dict.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession


async def tool_executor_node(state: dict, config: dict) -> dict:
    """
    Load, invoke, and map the output of a configured external tool.

    Args:
        state:  Current LangGraph state dict.  Must contain ``node_def``
                with ``tool_id``, ``input_map``, and ``output_map`` keys,
                as well as all state keys referenced by ``input_map``.
        config: LangGraph ``RunnableConfig``.  The ``configurable`` sub-dict
                must contain ``db`` (an injected ``AsyncSession``).

    Returns:
        Updated state dict with tool output values merged in according to
        the ``output_map`` configuration.

    Raises:
        NotImplementedError: Always — implementation pending.
    """
    raise NotImplementedError

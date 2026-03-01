"""
Tool executor node: load a Tool record, invoke it (builtin or HTTP),
map output back onto run state, and write RunNodeState.

Node config keys:
  tool_id     — UUID of the Tool record to invoke
  input_map   — {tool_param: state_key} — pull values from state into tool input
  output_map  — {state_key: tool_output_key} — push tool output keys into state
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    from knotwork.runtime.engine import RunState


def make_tool_executor_node(node_def: dict):
    """Factory returning an async LangGraph node function for a tool_executor node."""
    node_id = node_def["id"]
    cfg = node_def.get("config", {})
    tool_id: str | None = cfg.get("tool_id")
    input_map: dict = cfg.get("input_map", {})   # tool_param → state_key
    output_map: dict = cfg.get("output_map", {})  # state_key  → tool_output_key

    async def node_fn(state: "RunState") -> dict:
        from knotwork.database import AsyncSessionLocal
        from knotwork.runtime.events import publish_event
        from knotwork.runs.models import RunNodeState
        from knotwork.tools.models import Tool
        from knotwork.tools.service import execute_tool

        started_at = datetime.now(timezone.utc)
        run_id = UUID(state["run_id"])

        async with AsyncSessionLocal() as db:
            tool = await db.get(Tool, UUID(tool_id)) if tool_id else None

            if not tool:
                output = {"error": f"Tool {tool_id!r} not found in database"}
                node_status = "failed"
            else:
                input_data = {
                    param: state.get(state_key, "")
                    for param, state_key in input_map.items()
                } if input_map else {}

                result = await execute_tool(tool, input_data)
                if result.error:
                    output = {"error": result.error}
                    node_status = "failed"
                else:
                    output = result.output
                    node_status = "completed"

            node_input = {
                "run_input": state["input"],
                "previous_output": state.get("current_output"),
                "tool_input": input_data if tool else {},
            }
            ns = RunNodeState(
                run_id=run_id,
                node_id=node_id,
                status=node_status,
                input=node_input,
                output=output,
                started_at=started_at,
                completed_at=datetime.now(timezone.utc),
            )
            db.add(ns)
            await db.commit()

        state_updates: dict = {}
        if output_map and node_status == "completed":
            for state_key, output_key in output_map.items():
                if output_key in output:
                    state_updates[state_key] = output[output_key]

        await publish_event(state["run_id"], {
            "type": "node_completed",
            "node_id": node_id,
            "status": node_status,
        })

        return {
            "current_output": str(output),
            "messages": [{"role": "tool", "content": str(output), "node_id": node_id}],
            **state_updates,
        }

    return node_fn

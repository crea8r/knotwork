"""
Human Checkpoint node: always-human gate.

Calls LangGraph's interrupt() to suspend execution and surface the current
output for human review. The run is resumed via the /runs/{id}/resume endpoint
once the operator approves, edits, or aborts.

Walking skeleton: escalation record creation and notification dispatch
are stubs — added in Session 2.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from knotwork.runtime.engine import RunState


def make_human_checkpoint_node(node_def: dict):
    """
    Factory returning a LangGraph node function for a human_checkpoint node.

    Node config keys:
      prompt_to_operator — instructions shown to the operator in the escalation UI
    """
    config = node_def.get("config", {})
    prompt_to_operator: str = config.get(
        "prompt_to_operator",
        "Please review the output above and approve or provide guidance.",
    )

    def node_fn(state: "RunState") -> dict:
        from langgraph.types import interrupt

        # Suspend here. Execution resumes after operator action via /runs/{id}/resume.
        interrupt({
            "prompt": prompt_to_operator,
            "current_output": state.get("current_output"),
            "node_id": node_def["id"],
        })
        # Code below only runs after human resume
        return {}

    return node_fn

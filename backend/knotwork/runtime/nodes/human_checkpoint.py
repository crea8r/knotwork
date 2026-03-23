"""
Human Checkpoint node: always-human gate.

Creates an Escalation record, publishes an event, then calls interrupt() to
suspend execution. The run resumes via /runs/{id}/resume after operator action.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    from knotwork.runtime.engine import RunState


def make_human_checkpoint_node(node_def: dict):
    """
    Factory returning an async LangGraph node function for a human_checkpoint node.

    Node config keys:
      prompt_to_operator — instructions shown to the operator in the escalation UI
    """
    node_name = node_def.get("name") or node_def["id"]
    config = node_def.get("config", {})
    prompt_to_operator: str = config.get(
        "prompt_to_operator",
        "Please review the output above and approve or provide guidance.",
    )

    async def node_fn(state: "RunState") -> dict:
        from langgraph.types import interrupt

        from knotwork.database import AsyncSessionLocal
        from knotwork.escalations.service import create_escalation
        from knotwork.runtime.events import publish_event
        from knotwork.runs.models import RunNodeState

        run_id = str(state["run_id"])
        workspace_id = state["workspace_id"]
        current_output = state.get("current_output")

        async with AsyncSessionLocal() as db:
            ns = RunNodeState(
                run_id=run_id,
                node_id=node_def["id"],
                node_name=node_name,
                agent_ref="human",
                status="paused",
                output={"current_output": current_output},
                started_at=datetime.now(timezone.utc),
            )
            db.add(ns)
            await db.commit()
            await db.refresh(ns)

            esc = await create_escalation(
                db,
                run_id=run_id,
                run_node_state_id=ns.id,
                workspace_id=UUID(workspace_id),
                type="human_checkpoint",
                context={
                    "prompt": prompt_to_operator,
                    "current_output": current_output,
                    "node_id": node_def["id"],
                },
            )

        await publish_event(state["run_id"], {
            "type": "escalation_created",
            "escalation_id": str(esc.id),
            "node_id": node_def["id"],
        })

        # Suspend here. Execution resumes after operator action via /runs/{id}/resume.
        interrupt({
            "escalation_id": str(esc.id),
            "prompt": prompt_to_operator,
            "current_output": current_output,
            "node_id": node_def["id"],
        })
        return {}

    return node_fn

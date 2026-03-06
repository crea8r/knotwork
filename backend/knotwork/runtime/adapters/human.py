"""
Human adapter — pauses the run and waits for a human to respond.

Yields a single "escalation" event.  The engine creates an Escalation
record and triggers a LangGraph interrupt; the run resumes via the
existing escalation resolution flow (approve / edit / guide / abort).
"""
from __future__ import annotations

from typing import TYPE_CHECKING, AsyncGenerator

from knotwork.runtime.adapters.base import AgentAdapter, NodeEvent

if TYPE_CHECKING:
    from knotwork.runtime.knowledge_loader import KnowledgeTree


class HumanAdapter(AgentAdapter):
    """
    Gate that always hands control to a human operator.

    The node config may include a `question` field in config to customise
    the escalation prompt; defaults to "Awaiting human review.".
    """

    async def run_node(
        self,
        node_def: dict,
        run_state: dict,
        knowledge_tree: "KnowledgeTree",
        session_token: str,
    ) -> AsyncGenerator[NodeEvent, None]:
        config = node_def.get("config", {})
        question = config.get("question") or "Awaiting human review."
        options: list[str] = config.get("options", [])

        yield NodeEvent(
            type="escalation",
            payload={"question": question, "options": options},
        )

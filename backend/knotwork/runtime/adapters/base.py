"""
Agent adapter interface.

Every adapter must implement run_node() and yield NodeEvents.
The engine processes these events: writes logs/proposals to DB,
creates escalations, and on "completed" finalises the node output.

Event types:
  started    — adapter has begun; payload SHOULD include system_prompt and user_prompt
               so the debug screen shows the actual prompts sent to the model.
  log_entry  — agent wrote a worklog entry; payload: {content, entry_type, metadata}
  proposal   — agent proposes handbook edit; payload: {path, proposed_content, reason}
  escalation — agent wants human input; payload: {question, options}
  completed  — agent is done; payload: {output: str, next_branch: str | None}
  failed     — adapter error; payload: {error: str}
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, AsyncGenerator

if TYPE_CHECKING:
    from knotwork.runtime.knowledge_loader import KnowledgeTree


@dataclass
class NodeEvent:
    type: str
    payload: dict = field(default_factory=dict)


class AgentAdapter(ABC):
    """Pluggable adapter that runs a single node on behalf of the runtime engine."""

    @abstractmethod
    async def run_node(
        self,
        node_def: dict,
        run_state: dict,
        knowledge_tree: "KnowledgeTree",
        session_token: str,
        outgoing_edges: list[dict] | None = None,
        targets: list[str] | None = None,
        trust: float = 0.5,
        retry_guidance: str | None = None,
    ) -> AsyncGenerator[NodeEvent, None]:
        """
        Execute the node and yield NodeEvents.

        Args:
            node_def:       The full node dict from the graph definition
                            (includes id, name, agent_ref, trust_level, config).
            run_state:      The current LangGraph RunState dict.
            knowledge_tree: Pre-loaded KnowledgeTree for this node.
            session_token:  Scoped JWT for Agent API calls.
            outgoing_edges: List of {target, condition_label} dicts for ROUTING block.
            targets:        List of target node IDs for COMPLETION PROTOCOL.
            trust:          Trust level float 0.0–1.0 for AUTONOMY LEVEL block.
            retry_guidance: Human guidance text for retry after escalation.
                            When set, adapters should emit only HUMAN INTERVENTION
                            + tail blocks (no system_prompt).

        Yields:
            NodeEvent objects in order.  Must yield exactly one "completed"
            or one "failed" event as the final event.  The first event SHOULD
            be "started" with system_prompt and user_prompt in the payload so
            the debug screen reflects the actual prompts used.
        """
        ...

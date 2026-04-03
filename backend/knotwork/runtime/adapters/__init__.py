"""
Adapter registry — resolves agent_ref → AgentAdapter instance.

Supported agent_ref values:
  "human"  → HumanAdapter (any workspace operator resolves the escalation)

The bridge adapter (S12.2) will handle all non-human agent_refs by routing
through the participant model's notification + session mechanism. Until then,
non-human agent_refs raise NotImplementedError.
"""
from __future__ import annotations

from knotwork.runtime.adapters.base import AgentAdapter, NodeEvent

__all__ = ["AgentAdapter", "NodeEvent", "get_adapter"]


def get_adapter(agent_ref: str, api_key: str | None = None) -> AgentAdapter:
    """Return the adapter for the given agent_ref.

    Only 'human' is implemented. The bridge adapter (S12.2) will handle all
    other agent_refs. Until the bridge is built, non-human nodes raise
    NotImplementedError — assign agent_ref='human' for human-review nodes.
    """
    if agent_ref == "human":
        from knotwork.runtime.adapters.human import HumanAdapter
        return HumanAdapter()

    raise NotImplementedError(
        f"No adapter for agent_ref '{agent_ref}'. "
        "The agent bridge is not yet implemented (S12.2). "
        "Use agent_ref='human' for human-review nodes."
    )

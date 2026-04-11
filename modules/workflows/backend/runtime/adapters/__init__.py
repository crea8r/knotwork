"""
Adapter registry — resolves agent_ref → AgentAdapter instance.

Supported agent_ref values:
  "human"  → HumanAdapter (any workspace operator resolves the escalation)

The bridge adapter (S12.2) will handle all non-human agent_refs by routing
through the participant model's notification + session mechanism. Until then,
non-human agent_refs raise NotImplementedError.
"""
from __future__ import annotations

from .base import AgentAdapter, NodeEvent

__all__ = ["AgentAdapter", "NodeEvent", "get_adapter"]


def get_adapter(agent_ref: str, api_key: str | None = None) -> AgentAdapter:
    """Return the adapter for the given agent_ref.

    Supported today:
    - 'human'
    Direct model-backed adapters are disabled in this build.
    """
    if agent_ref == "human":
        from .human import HumanAdapter
        return HumanAdapter()

    raise NotImplementedError(
        f"No adapter for agent_ref '{agent_ref}'. "
        "Direct model-backed agent execution is disabled. Use 'human'."
    )

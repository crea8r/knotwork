"""
Adapter registry — resolves agent_ref → AgentAdapter instance.

Supported agent_ref values:
  "human"      → HumanAdapter   (any workspace operator resolves the escalation)
  "openclaw"   → OpenClawAdapter (specific agent identified by registered_agent_id on the node)

Claude/OpenAI adapters are still available in their modules for other system
parts (designer, suggestions, etc.) but are NOT routed here for node execution.
"""
from __future__ import annotations

from knotwork.runtime.adapters.base import AgentAdapter, NodeEvent

__all__ = ["AgentAdapter", "NodeEvent", "get_adapter"]


def get_adapter(agent_ref: str, api_key: str | None = None) -> AgentAdapter:
    """Return the adapter for the given agent_ref.

    Only 'human' and 'openclaw' are valid for node execution.
    The specific agent is identified via registered_agent_id on the node def,
    not by the agent_ref string.
    """
    if agent_ref == "human":
        from knotwork.runtime.adapters.human import HumanAdapter
        return HumanAdapter()

    if agent_ref == "openclaw":
        from knotwork.runtime.adapters.openclaw import OpenClawAdapter
        return OpenClawAdapter()

    raise ValueError(
        f"Unknown agent_ref '{agent_ref}' for node execution. "
        "Only 'human' and 'openclaw' are supported. "
        "Set agent_ref on the node and assign a registered_agent_id."
    )

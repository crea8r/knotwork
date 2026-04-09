"""
Adapter registry — resolves agent_ref → AgentAdapter instance.

Supported agent_ref values:
  "human"  → HumanAdapter (any workspace operator resolves the escalation)
  "openai:*" → OpenAIAdapter
  "anthropic:*" → ClaudeAdapter

The bridge adapter (S12.2) will handle all non-human agent_refs by routing
through the participant model's notification + session mechanism. Until then,
non-human agent_refs raise NotImplementedError.
"""
from __future__ import annotations

from knotwork.runtime.adapters.base import AgentAdapter, NodeEvent

__all__ = ["AgentAdapter", "NodeEvent", "get_adapter"]


def get_adapter(agent_ref: str, api_key: str | None = None) -> AgentAdapter:
    """Return the adapter for the given agent_ref.

    Supported today:
    - 'human'
    - 'openai:<model>'
    - 'anthropic:<model>'

    OpenClaw / bridge-routed refs are not yet implemented in the backend
    runtime and must be blocked before execution.
    """
    if agent_ref == "human":
        from knotwork.runtime.adapters.human import HumanAdapter
        return HumanAdapter()
    if agent_ref.startswith("openai:"):
        from knotwork.runtime.adapters.openai_adapter import OpenAIAdapter
        return OpenAIAdapter(api_key=api_key)
    if agent_ref.startswith("anthropic:"):
        from knotwork.runtime.adapters.claude import ClaudeAdapter
        return ClaudeAdapter(api_key=api_key)

    raise NotImplementedError(
        f"No adapter for agent_ref '{agent_ref}'. "
        "OpenClaw/bridge-backed agent execution is not wired into the backend runtime yet. "
        "Use a supported direct model ref ('openai:*' or 'anthropic:*') or 'human'."
    )

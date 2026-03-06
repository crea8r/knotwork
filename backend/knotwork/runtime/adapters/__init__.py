"""
Adapter registry — resolves agent_ref → AgentAdapter instance.

Supported agent_ref formats:
  "human"                       → HumanAdapter
  "anthropic:<model-id>"        → ClaudeAdapter
  "openai:<model-id>"           → OpenAIAdapter
  "openclaw:<agent-slug>"       → OpenClawAdapter
"""
from __future__ import annotations

from knotwork.runtime.adapters.base import AgentAdapter, NodeEvent

__all__ = ["AgentAdapter", "NodeEvent", "get_adapter"]


def get_adapter(agent_ref: str, api_key: str | None = None) -> AgentAdapter:
    """Return the appropriate adapter for the given agent_ref string.

    api_key overrides the environment variable when a workspace-registered
    API key is provided (S7.1 registered agents).
    """
    if agent_ref == "human":
        from knotwork.runtime.adapters.human import HumanAdapter
        return HumanAdapter()

    if agent_ref.startswith("anthropic:"):
        from knotwork.runtime.adapters.claude import ClaudeAdapter
        return ClaudeAdapter(api_key=api_key)

    if agent_ref.startswith("openai:"):
        from knotwork.runtime.adapters.openai_adapter import OpenAIAdapter
        return OpenAIAdapter(api_key=api_key)

    if agent_ref.startswith("openclaw:"):
        from knotwork.runtime.adapters.openclaw import OpenClawAdapter
        return OpenClawAdapter()

    raise ValueError(
        f"Unknown agent_ref '{agent_ref}'. "
        "Expected 'human', 'anthropic:<model>', 'openai:<model>', or 'openclaw:<agent>'."
    )

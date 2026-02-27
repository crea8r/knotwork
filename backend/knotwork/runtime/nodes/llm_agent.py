"""
LLM Agent node: core reasoning node.

Loads knowledge via load_knowledge_tree(), builds GUIDELINES/CASE prompt via
build_agent_prompt(), calls the configured LLM, returns updated state.

Walking skeleton: confidence scoring and RunNodeState DB writes are stubs.
Full implementation adds retry, confidence eval, and RunNodeState persistence.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from knotwork.runtime.engine import RunState


def _get_llm(model: str):
    """Route model string → LangChain chat model instance."""
    name = model.removeprefix("openai/").removeprefix("anthropic/")
    if model.startswith("anthropic/") or model.startswith("claude"):
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=name, temperature=0.1)
    # Default: OpenAI
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(model=name, temperature=0.1)


def make_llm_agent_node(node_def: dict):
    """
    Factory returning a LangGraph node function for an llm_agent node.

    Node config keys:
      model           — override workspace default model
      knowledge_files — list of handbook paths to load
      instructions    — extra system instructions appended after guidelines
    """
    node_id = node_def["id"]
    config = node_def.get("config", {})
    model_override: str | None = config.get("model")
    knowledge_files: list[str] = config.get("knowledge_files", [])
    extra_instructions: str = config.get("instructions", "")

    async def node_fn(state: "RunState") -> dict:
        from langchain_core.messages import HumanMessage, SystemMessage

        from knotwork.config import settings
        from knotwork.runtime.knowledge_loader import KnowledgeTree, load_knowledge_tree
        from knotwork.runtime.prompt_builder import build_agent_prompt

        model = model_override or settings.default_model
        llm = _get_llm(model)

        tree = (
            await load_knowledge_tree(knowledge_files, state["workspace_id"])
            if knowledge_files
            else KnowledgeTree()
        )

        system_prompt, user_prompt = build_agent_prompt(
            tree=tree,
            state_fields=state["input"],
            context_files=state["context_files"],
        )
        if extra_instructions:
            system_prompt = f"{system_prompt}\n\n{extra_instructions}"

        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ])
        output = response.content if hasattr(response, "content") else str(response)

        return {
            "current_output": output,
            "messages": [{"role": "assistant", "content": output, "node_id": node_id}],
        }

    return node_fn

"""
Designer agent: conversational LLM assistant for building knotwork graphs.

The agent accepts natural-language messages from the user and returns:
  - A natural-language reply to display in the designer chat UI.
  - A ``graph_delta`` describing the incremental changes to apply to the
    current graph definition (nodes to add/update/remove, edges to wire).
  - A ``questions`` list of clarifying questions when the description is
    ambiguous.

The agent maintains multi-turn context via the ``session_id`` and loads the
existing graph definition on each turn so it can reason about what already
exists before proposing changes.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession


async def design_graph(
    session_id: str,
    message: str,
    workspace_id: str,
    existing_graph: dict | None,
    db: AsyncSession,
) -> dict:
    """
    Process a designer chat message and return graph modifications.

    The LLM is prompted with the current graph definition and the full
    conversation history for ``session_id``.  It produces a structured
    response that is parsed into a ``graph_delta`` and optional clarifying
    ``questions``.

    Args:
        session_id:     Identifier for the ongoing designer session.  Used to
                        load and persist conversation history.
        message:        The user's latest natural-language message.
        workspace_id:   UUID of the workspace the graph belongs to.
        existing_graph: Current serialised graph definition, or ``None`` when
                        starting a new graph from scratch.
        db:             Active async SQLAlchemy session.

    Returns:
        A dict with three keys:

        - ``reply`` (``str``): Human-readable assistant message.
        - ``graph_delta`` (``dict``): Incremental graph changes with
          ``add_nodes``, ``update_nodes``, ``remove_nodes``, ``add_edges``,
          and ``remove_edges`` lists.
        - ``questions`` (``list[str]``): Clarifying questions for the user;
          empty when the description is unambiguous.

    Raises:
        NotImplementedError: Always — implementation pending.
    """
    raise NotImplementedError

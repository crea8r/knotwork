"""
Knowledge file health scoring.

A health score in [0.0, 5.0] summarises how well a knowledge file is
performing as a context source for LLM agents.  It is re-computed on demand
and cached in the ``KnowledgeFile`` record.

Composite score breakdown
-------------------------
The score is a weighted sum of four signals, each normalised to [0.0, 5.0]:

  - **token_score** (weight 20 %): derived from token count relative to
    the configured model's context window.  Files that are too short or
    extremely long receive a lower token score.
  - **confidence_score** (weight 30 %): mean confidence of all ``RunNodeState``
    records that referenced this file.
  - **escalation_score** (weight 25 %): inverse of the escalation rate —
    files that frequently trigger human review score lower.
  - **rating_score** (weight 25 %): mean of operator star ratings submitted
    on runs where this file contributed to the output.

Returns ``0.0`` when there are no run records yet (cold-start state).
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession


async def compute_health_score(file_id: str, db: AsyncSession) -> float:
    """
    Compute the composite health score for a knowledge file.

    Args:
        file_id: UUID of the ``KnowledgeFile`` to score.
        db:      Active async SQLAlchemy session used to query run data.

    Returns:
        A float in ``[0.0, 5.0]``.  Returns ``0.0`` when no run data
        exists for the file (cold-start).

    Raises:
        NotImplementedError: Always — implementation pending.
    """
    raise NotImplementedError

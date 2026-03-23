from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.ratings.models import Rating
from knotwork.ratings.schemas import RatingCreate


async def upsert_rating(
    db: AsyncSession,
    run_id: str,
    run_node_state_id: UUID,
    workspace_id: UUID,
    data: RatingCreate,
    rated_by: UUID | None = None,
) -> Rating:
    """
    Create or replace a rating for a run node state.
    If a human rating already exists for this node state, it is overwritten.
    """
    existing_q = select(Rating).where(
        Rating.run_node_state_id == run_node_state_id,
        Rating.source == "human",
    )
    result = await db.execute(existing_q)
    existing = result.scalars().first()

    if existing:
        existing.score = data.score
        existing.comment = data.comment
        await db.commit()
        await db.refresh(existing)
        return existing

    rating = Rating(
        run_id=run_id,
        run_node_state_id=run_node_state_id,
        workspace_id=workspace_id,
        rated_by=rated_by,
        source=data.source,
        score=data.score,
        comment=data.comment,
    )
    db.add(rating)
    await db.commit()
    await db.refresh(rating)
    return rating


async def list_ratings(
    db: AsyncSession,
    workspace_id: UUID,
    node_id: str | None = None,
    score_lte: int | None = None,
) -> list[Rating]:
    q = select(Rating).where(Rating.workspace_id == workspace_id)
    if score_lte is not None:
        q = q.where(Rating.score <= score_lte)
    q = q.order_by(Rating.created_at.desc())
    result = await db.execute(q)
    return list(result.scalars())

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db
from knotwork.ratings import service
from knotwork.ratings.schemas import RatingCreate, RatingOut
from knotwork.runs.models import RunNodeState

router = APIRouter(prefix="/workspaces", tags=["ratings"])


@router.post(
    "/{workspace_id}/runs/{run_id}/nodes/{node_state_id}/rating",
    response_model=RatingOut,
    status_code=201,
)
async def submit_rating(
    workspace_id: UUID,
    run_id: UUID,
    node_state_id: UUID,
    data: RatingCreate,
    db: AsyncSession = Depends(get_db),
):
    ns = await db.get(RunNodeState, node_state_id)
    if not ns or ns.run_id != run_id:
        raise HTTPException(404, "Node state not found")
    rating = await service.upsert_rating(
        db,
        run_id=run_id,
        run_node_state_id=node_state_id,
        workspace_id=workspace_id,
        data=data,
    )
    return RatingOut.model_validate(rating)


@router.get("/{workspace_id}/ratings", response_model=list[RatingOut])
async def list_ratings(
    workspace_id: UUID,
    node_id: str | None = None,
    score_lte: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    ratings = await service.list_ratings(db, workspace_id, node_id=node_id, score_lte=score_lte)
    return [RatingOut.model_validate(r) for r in ratings]

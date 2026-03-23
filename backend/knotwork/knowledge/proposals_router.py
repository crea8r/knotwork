"""
Handbook proposal review endpoints (S7).

Agents propose handbook changes during runs; humans approve or reject here.
Approving a proposal writes the proposed_content to the handbook file via StorageAdapter.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.database import get_db

router = APIRouter(prefix="/workspaces", tags=["proposals"])


class ProposalOut(BaseModel):
    id: UUID
    run_id: str
    node_id: str
    agent_ref: str | None
    path: str
    proposed_content: str
    reason: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ProposalReview(BaseModel):
    final_content: str | None = None  # if editor changed the text before approving


@router.get("/{workspace_id}/handbook/proposals", response_model=list[ProposalOut])
async def list_proposals(
    workspace_id: UUID,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    from knotwork.runs.models import RunHandbookProposal

    q = select(RunHandbookProposal).order_by(RunHandbookProposal.created_at.desc())
    if status:
        q = q.where(RunHandbookProposal.status == status)
    result = await db.execute(q)
    return list(result.scalars())


@router.post("/{workspace_id}/handbook/proposals/{proposal_id}/approve", response_model=ProposalOut)
async def approve_proposal(
    workspace_id: UUID,
    proposal_id: UUID,
    body: ProposalReview,
    db: AsyncSession = Depends(get_db),
):
    from knotwork.knowledge import service as svc
    from knotwork.runs.models import RunHandbookProposal

    proposal = await db.get(RunHandbookProposal, proposal_id)
    if not proposal:
        raise HTTPException(404, "Proposal not found")
    if proposal.status != "pending":
        raise HTTPException(409, f"Proposal is already {proposal.status}")

    content_to_write = body.final_content or proposal.proposed_content

    # Write or update the handbook file via the knowledge service
    try:
        existing = await svc.get_file_by_path(db, workspace_id, proposal.path)
        if existing:
            await svc.update_file(
                db, workspace_id, proposal.path, content_to_write,
                updated_by="agent_proposal", change_summary=f"Approved proposal: {proposal.reason[:80]}",
            )
        else:
            title = proposal.path.split("/")[-1].replace("-", " ").replace("_", " ").title()
            await svc.create_file(
                db, workspace_id, proposal.path, title, content_to_write,
                created_by="agent_proposal", change_summary=f"Approved proposal: {proposal.reason[:80]}",
            )
    except Exception as exc:
        raise HTTPException(500, f"Failed to write handbook file: {exc}")

    proposal.status = "approved"
    proposal.final_content = content_to_write
    proposal.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(proposal)
    return proposal


@router.post("/{workspace_id}/handbook/proposals/{proposal_id}/reject", response_model=ProposalOut)
async def reject_proposal(
    workspace_id: UUID,
    proposal_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    from knotwork.runs.models import RunHandbookProposal

    proposal = await db.get(RunHandbookProposal, proposal_id)
    if not proposal:
        raise HTTPException(404, "Proposal not found")
    if proposal.status != "pending":
        raise HTTPException(409, f"Proposal is already {proposal.status}")

    proposal.status = "rejected"
    proposal.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(proposal)
    return proposal

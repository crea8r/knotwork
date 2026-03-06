"""
Agent API — 4 endpoints used by external agents during a run.

All endpoints require a session JWT in `Authorization: Bearer <token>`.
The token is scoped to a single (run_id, node_id, workspace_id) tuple.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from knotwork.agent_api.session import verify_session_token
from knotwork.config import settings

router = APIRouter(prefix="/agent-api", tags=["agent-api"])

_AUTH_ERR = {"error": "invalid or expired session token"}


def _decode(authorization: str | None) -> dict[str, Any]:
    """Extract and verify the Bearer token.  Raises 401 on failure."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, detail=_AUTH_ERR)
    token = authorization.removeprefix("Bearer ").strip()
    try:
        return verify_session_token(token, settings.jwt_secret)
    except ValueError:
        raise HTTPException(401, detail=_AUTH_ERR)


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #

class LogBody(BaseModel):
    content: str
    entry_type: str = "observation"
    metadata: dict = {}


class ProposeBody(BaseModel):
    path: str
    proposed_content: str
    reason: str


class EscalateBody(BaseModel):
    question: str
    options: list[str] = []


class CompleteBody(BaseModel):
    output: Any
    next_branch: str | None = None


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #

@router.post("/log")
async def log_entry(body: LogBody, authorization: str | None = Header(None)):
    claims = _decode(authorization)
    run_id = UUID(claims["run_id"])
    node_id = claims["node_id"]

    from knotwork.database import AsyncSessionLocal
    from knotwork.runs.models import RunWorklogEntry

    entry = RunWorklogEntry(
        id=uuid4(),
        run_id=run_id,
        node_id=node_id,
        agent_ref=claims.get("agent_ref"),
        entry_type=body.entry_type,
        content=body.content,
        metadata_=body.metadata,
    )
    async with AsyncSessionLocal() as db:
        db.add(entry)
        await db.commit()
        await db.refresh(entry)

    return {"id": str(entry.id)}


@router.post("/propose")
async def propose_handbook(body: ProposeBody, authorization: str | None = Header(None)):
    claims = _decode(authorization)
    run_id = UUID(claims["run_id"])
    node_id = claims["node_id"]

    from knotwork.database import AsyncSessionLocal
    from knotwork.runs.models import RunHandbookProposal

    proposal = RunHandbookProposal(
        id=uuid4(),
        run_id=run_id,
        node_id=node_id,
        agent_ref=claims.get("agent_ref"),
        path=body.path,
        proposed_content=body.proposed_content,
        reason=body.reason,
        status="pending",
    )
    async with AsyncSessionLocal() as db:
        db.add(proposal)
        await db.commit()
        await db.refresh(proposal)

    return {"id": str(proposal.id)}


@router.post("/escalate")
async def escalate(body: EscalateBody, authorization: str | None = Header(None)):
    claims = _decode(authorization)
    run_id = UUID(claims["run_id"])
    node_id = claims["node_id"]
    workspace_id = UUID(claims["workspace_id"])

    from knotwork.database import AsyncSessionLocal
    from knotwork.runs.models import Run, RunNodeState

    async with AsyncSessionLocal() as db:
        # Find the active RunNodeState for this run + node
        from sqlalchemy import select
        ns_q = await db.execute(
            select(RunNodeState)
            .where(RunNodeState.run_id == run_id, RunNodeState.node_id == node_id)
            .order_by(RunNodeState.started_at.desc())
            .limit(1)
        )
        node_state = ns_q.scalar_one_or_none()
        if node_state is None:
            raise HTTPException(404, "Node state not found")

        node_state.status = "paused"
        run = await db.get(Run, run_id)
        if run:
            run.status = "paused"

        from knotwork.escalations.service import create_escalation
        esc = await create_escalation(
            db,
            run_id=run_id,
            run_node_state_id=node_state.id,
            workspace_id=workspace_id,
            type="agent_question",
            context={"question": body.question, "options": body.options},
        )

    return {"escalation_id": str(esc.id)}


@router.post("/complete")
async def complete_node(body: CompleteBody, authorization: str | None = Header(None)):
    claims = _decode(authorization)
    run_id = UUID(claims["run_id"])
    node_id = claims["node_id"]

    from sqlalchemy import select

    from knotwork.database import AsyncSessionLocal
    from knotwork.runs.models import RunNodeState

    async with AsyncSessionLocal() as db:
        ns_q = await db.execute(
            select(RunNodeState)
            .where(RunNodeState.run_id == run_id, RunNodeState.node_id == node_id)
            .order_by(RunNodeState.started_at.desc())
            .limit(1)
        )
        node_state = ns_q.scalar_one_or_none()
        if node_state is None:
            raise HTTPException(404, "Node state not found")

        output = body.output if isinstance(body.output, dict) else {"text": str(body.output)}
        node_state.output = output
        node_state.next_branch = body.next_branch
        node_state.status = "completed"
        node_state.completed_at = datetime.now(timezone.utc)
        await db.commit()

    return {"ok": True}

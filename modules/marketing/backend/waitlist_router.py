from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db
from modules.marketing.backend.waitlist_models import WaitlistSignup

router = APIRouter(prefix="/public", tags=["public"])


class WaitlistSignupIn(BaseModel):
    email: EmailStr
    team_size: str | None = Field(default=None, max_length=32)
    outcome: str | None = Field(default=None, max_length=5000)
    source: str | None = Field(default=None, max_length=64)


@router.post("/waitlist")
async def join_waitlist(payload: WaitlistSignupIn, db: AsyncSession = Depends(get_db)):
    row = WaitlistSignup(
        email=str(payload.email).strip().lower(),
        team_size=payload.team_size,
        outcome=payload.outcome,
        source=payload.source,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()

    return JSONResponse(status_code=200, content={"ok": True})

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.deps import get_current_user, get_workspace_member
from knotwork.auth.models import User
from knotwork.database import get_db
from knotwork.workspaces.models import Workspace, WorkspaceMember

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


class WorkspaceOut(BaseModel):
    id: str
    name: str
    slug: str
    member_role: str


class MemberOut(BaseModel):
    id: str
    user_id: str
    name: str
    email: str
    role: str
    avatar_url: str | None
    bio: str | None
    joined_at: str


class MembersPage(BaseModel):
    items: list[MemberOut]
    total: int
    page: int
    page_size: int


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WorkspaceOut]:
    """Return all workspaces the current user belongs to, with their role."""
    result = await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user.id)
        .order_by(Workspace.created_at)
    )
    return [
        WorkspaceOut(id=str(ws.id), name=ws.name, slug=ws.slug, member_role=role)
        for ws, role in result.all()
    ]


@router.get("/{workspace_id}/members", response_model=MembersPage)
async def list_workspace_members(
    workspace_id: UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> MembersPage:
    """List all members of a workspace with pagination."""
    total_result = await db.execute(
        select(func.count()).where(WorkspaceMember.workspace_id == workspace_id)
    )
    total = total_result.scalar_one()

    rows = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [
        MemberOut(
            id=str(m.id),
            user_id=str(u.id),
            name=u.name,
            email=u.email,
            role=m.role,
            avatar_url=u.avatar_url,
            bio=u.bio,
            joined_at=m.created_at.isoformat(),
        )
        for m, u in rows.all()
    ]
    return MembersPage(items=items, total=total, page=page, page_size=page_size)


@router.post("")
async def create_workspace():
    return {"message": "not implemented"}


@router.get("/{workspace_id}")
async def get_workspace(workspace_id: str):
    return {"message": "not implemented"}


@router.patch("/{workspace_id}")
async def update_workspace(workspace_id: str):
    return {"message": "not implemented"}


@router.post("/{workspace_id}/members")
async def add_workspace_member(workspace_id: str):
    return {"message": "not implemented"}

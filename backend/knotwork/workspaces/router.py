import base64
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.deps import get_current_user, get_workspace_member, require_owner
from knotwork.auth.models import User
from knotwork.database import get_db
from knotwork.workspaces.guide import DEFAULT_GUIDE_MD
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
    email: str | None  # null for agent accounts
    role: str
    kind: str  # 'human' | 'agent'
    avatar_url: str | None
    bio: str | None
    joined_at: str


class AddAgentMemberIn(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=200)
    public_key: str = Field(..., description="ed25519 public key, base64url-encoded (32 raw bytes)")
    role: str = Field(default="operator", pattern="^(operator|owner)$")


class MembersPage(BaseModel):
    items: list[MemberOut]
    total: int
    page: int
    page_size: int


class WorkspaceEmailConfigOut(BaseModel):
    enabled: bool
    has_resend_api_key: bool
    email_from: str | None


class WorkspaceEmailConfigUpdate(BaseModel):
    resend_api_key: str | None = Field(default=None, max_length=500)
    clear_resend_api_key: bool = False
    email_from: str | None = Field(default=None, max_length=320)


class WorkspaceGuideOut(BaseModel):
    guide_md: str | None
    guide_version: int


class WorkspaceGuideUpdate(BaseModel):
    guide_md: str = Field(..., max_length=50_000)


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
    kind: str | None = Query(None, description="Filter by 'human' or 'agent'"),
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> MembersPage:
    """List all members of a workspace with pagination. Filter by kind=human|agent."""
    base = select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id)
    if kind:
        base = base.where(WorkspaceMember.kind == kind)

    total_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = total_result.scalar_one()

    member_query = (
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(WorkspaceMember.created_at)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if kind:
        member_query = member_query.where(WorkspaceMember.kind == kind)
    rows = await db.execute(member_query)
    items = [
        MemberOut(
            id=str(m.id),
            user_id=str(u.id),
            name=u.name,
            email=u.email,
            role=m.role,
            kind=m.kind,
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


@router.get("/{workspace_id}/email-config", response_model=WorkspaceEmailConfigOut)
async def get_workspace_email_config(
    workspace_id: UUID,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceEmailConfigOut:
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return WorkspaceEmailConfigOut(
        enabled=bool((workspace.resend_api_key or "").strip()),
        has_resend_api_key=bool((workspace.resend_api_key or "").strip()),
        email_from=(workspace.email_from or "").strip() or None,
    )


@router.patch("/{workspace_id}/email-config", response_model=WorkspaceEmailConfigOut)
async def update_workspace_email_config(
    workspace_id: UUID,
    data: WorkspaceEmailConfigUpdate,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceEmailConfigOut:
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if data.clear_resend_api_key:
        workspace.resend_api_key = None
    elif data.resend_api_key is not None:
        value = data.resend_api_key.strip()
        workspace.resend_api_key = value or None

    if data.email_from is not None:
        workspace.email_from = data.email_from.strip() or None

    await db.commit()
    await db.refresh(workspace)

    return WorkspaceEmailConfigOut(
        enabled=bool((workspace.resend_api_key or "").strip()),
        has_resend_api_key=bool((workspace.resend_api_key or "").strip()),
        email_from=(workspace.email_from or "").strip() or None,
    )


@router.post("/{workspace_id}/members", response_model=MemberOut)
async def add_workspace_member(
    workspace_id: UUID,
    data: AddAgentMemberIn,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    """Add an agent member via ed25519 public key (owner only)."""
    # Validate public_key: must be valid base64url-encoded ed25519 (32 bytes)
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        raw = base64.urlsafe_b64decode(data.public_key + "==")
        if len(raw) != 32:
            raise ValueError("key must be 32 bytes")
        Ed25519PublicKey.from_public_bytes(raw)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid ed25519 public key — must be base64url-encoded 32 bytes")

    # Check key not already in use
    existing = await db.execute(select(User).where(User.public_key == data.public_key))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="A member with this public key already exists")

    # Check workspace exists
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Create User row (no email — agent account)
    user = User(
        name=data.display_name,
        email=None,
        public_key=data.public_key,
    )
    db.add(user)
    await db.flush()  # get user.id

    # Create WorkspaceMember row
    member = WorkspaceMember(
        workspace_id=workspace_id,
        user_id=user.id,
        role=data.role,
        kind="agent",
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)

    return MemberOut(
        id=str(member.id),
        user_id=str(user.id),
        name=user.name,
        email=None,
        role=member.role,
        kind=member.kind,
        avatar_url=user.avatar_url,
        bio=user.bio,
        joined_at=member.created_at.isoformat(),
    )


@router.get("/{workspace_id}/guide", response_model=WorkspaceGuideOut)
async def get_workspace_guide(
    workspace_id: UUID,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceGuideOut:
    """Return the workspace guide and its current version (any member)."""
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return WorkspaceGuideOut(
        guide_md=workspace.guide_md,
        guide_version=workspace.guide_version,
    )


@router.put("/{workspace_id}/guide", response_model=WorkspaceGuideOut)
async def update_workspace_guide(
    workspace_id: UUID,
    data: WorkspaceGuideUpdate,
    _member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceGuideOut:
    """Replace the workspace guide and increment its version (owner only)."""
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    workspace.guide_md = data.guide_md
    workspace.guide_version = (workspace.guide_version or 0) + 1
    await db.commit()
    await db.refresh(workspace)
    return WorkspaceGuideOut(
        guide_md=workspace.guide_md,
        guide_version=workspace.guide_version,
    )

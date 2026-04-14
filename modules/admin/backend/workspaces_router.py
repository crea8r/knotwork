import base64
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from libs.database import get_db
from libs.auth.backend.deps import get_current_user, get_workspace_member, require_owner
from libs.auth.backend import service as auth_service
from libs.auth.backend.models import User
from .workspaces_guide import DEFAULT_GUIDE_MD
from .workspaces_models import Workspace, WorkspaceMember

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
    agent_zero_role: bool = False
    contribution_brief: str | None = None
    availability_status: str = "available"
    capacity_level: str = "open"
    status_note: str | None = None
    current_commitments: list[dict] = Field(default_factory=list)
    recent_work: list[dict] = Field(default_factory=list)
    status_updated_at: str | None = None
    joined_at: str
    access_disabled_at: str | None = None


class AddAgentMemberIn(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=200)
    public_key: str = Field(..., description="ed25519 public key, base64url-encoded (32 raw bytes)")
    role: str = Field(default="operator", pattern="^(operator|owner)$")


class MembersPage(BaseModel):
    items: list[MemberOut]
    total: int
    page: int
    page_size: int


class UpdateMemberAccessIn(BaseModel):
    access_disabled: bool | None = None
    agent_zero_role: bool | None = None
    contribution_brief: str | None = Field(default=None, max_length=500)
    availability_status: str | None = Field(default=None, pattern="^(available|focused|busy|away|blocked)$")
    capacity_level: str | None = Field(default=None, pattern="^(open|limited|full)$")
    status_note: str | None = Field(default=None, max_length=500)
    current_commitments: list[dict] | None = None
    recent_work: list[dict] | None = None


class ResetMemberPasswordIn(BaseModel):
    new_password: str = Field(..., min_length=4, max_length=200)


def _member_out(member: WorkspaceMember, user: User) -> MemberOut:
    return MemberOut(
        id=str(member.id),
        user_id=str(user.id),
        name=user.name,
        email=user.email,
        role=member.role,
        kind=member.kind,
        avatar_url=user.avatar_url,
        bio=user.bio,
        agent_zero_role=bool(member.agent_zero_role),
        contribution_brief=member.contribution_brief,
        availability_status=member.availability_status or "available",
        capacity_level=member.capacity_level or "open",
        status_note=member.status_note,
        current_commitments=member.current_commitments or [],
        recent_work=member.recent_work or [],
        status_updated_at=member.status_updated_at.isoformat() if member.status_updated_at else None,
        joined_at=member.created_at.isoformat(),
        access_disabled_at=member.access_disabled_at.isoformat() if member.access_disabled_at else None,
    )


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
        .where(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.access_disabled_at.is_(None),
        )
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
    disabled: bool | None = Query(None, description="Filter by disabled state"),
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> MembersPage:
    """List all members of a workspace with pagination. Filter by kind=human|agent."""
    base = select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id)
    if kind:
        base = base.where(WorkspaceMember.kind == kind)
    if disabled is not None:
        base = base.where(
            WorkspaceMember.access_disabled_at.is_not(None)
            if disabled
            else WorkspaceMember.access_disabled_at.is_(None)
        )

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
    if disabled is not None:
        member_query = member_query.where(
            WorkspaceMember.access_disabled_at.is_not(None)
            if disabled
            else WorkspaceMember.access_disabled_at.is_(None)
        )
    rows = await db.execute(member_query)
    items = [
        _member_out(m, u)
        for m, u in rows.all()
    ]
    return MembersPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/{workspace_id}/members/{member_id}", response_model=MemberOut)
async def get_workspace_member_detail(
    workspace_id: UUID,
    member_id: UUID,
    _member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    member = await db.get(WorkspaceMember, member_id)
    if member is None or member.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Member not found")
    user = await db.get(User, member.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return _member_out(member, user)


@router.patch("/{workspace_id}/members/{member_id}", response_model=MemberOut)
async def update_workspace_member_access(
    workspace_id: UUID,
    member_id: UUID,
    data: UpdateMemberAccessIn,
    user: User = Depends(get_current_user),
    caller_member: WorkspaceMember = Depends(get_workspace_member),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    member = await db.get(WorkspaceMember, member_id)
    if member is None or member.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Member not found")
    profile_fields_present = any(
        value is not None
        for value in (
            data.contribution_brief,
            data.availability_status,
            data.capacity_level,
            data.status_note,
            data.current_commitments,
            data.recent_work,
        )
    )
    if data.access_disabled is None and data.agent_zero_role is None and not profile_fields_present:
        raise HTTPException(status_code=400, detail="No member update provided")
    is_owner = caller_member.role == "owner"
    if (data.access_disabled is not None or data.agent_zero_role is not None) and not is_owner:
        raise HTTPException(status_code=403, detail="Only owners can update member access or AgentZero role")
    if data.access_disabled is True and member.user_id == caller_member.user_id:
        raise HTTPException(status_code=400, detail="Owners cannot disable their own access")
    if profile_fields_present and member.user_id != user.id and not is_owner:
        raise HTTPException(status_code=403, detail="Only owners can update another member's profile")

    if data.access_disabled is not None:
        member.access_disabled_at = datetime.now(timezone.utc) if data.access_disabled else None
    if data.agent_zero_role is not None:
        if data.agent_zero_role:
            await db.execute(
                update(WorkspaceMember)
                .where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.id != member.id,
                    WorkspaceMember.agent_zero_role.is_(True),
                )
                .values(agent_zero_role=False)
            )
        member.agent_zero_role = data.agent_zero_role
    if data.contribution_brief is not None:
        member.contribution_brief = data.contribution_brief.strip() or None
    status_changed = False
    if data.availability_status is not None:
        member.availability_status = data.availability_status
        status_changed = True
    if data.capacity_level is not None:
        member.capacity_level = data.capacity_level
        status_changed = True
    if data.status_note is not None:
        member.status_note = data.status_note.strip() or None
        status_changed = True
    if data.current_commitments is not None:
        member.current_commitments = data.current_commitments
        status_changed = True
    if data.recent_work is not None:
        member.recent_work = data.recent_work
        status_changed = True
    if status_changed:
        member.status_updated_at = datetime.now(timezone.utc)
    await db.commit()
    user = await db.get(User, member.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    await db.refresh(member)
    return _member_out(member, user)


@router.post("/{workspace_id}/members/{member_id}/reset-password", response_model=MemberOut)
async def reset_workspace_member_password(
    workspace_id: UUID,
    member_id: UUID,
    data: ResetMemberPasswordIn,
    caller_member: WorkspaceMember = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    member = await db.get(WorkspaceMember, member_id)
    if member is None or member.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.user_id == caller_member.user_id:
        raise HTTPException(status_code=400, detail="Use Account settings to change your own password")
    if member.kind != "human":
        raise HTTPException(status_code=400, detail="Only human members can use password login")

    user = await db.get(User, member.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not (user.email or "").strip():
        raise HTTPException(status_code=400, detail="Target user has no email login")

    try:
        auth_service.set_user_password(user, data.new_password, must_change_password=True)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await db.commit()
    await db.refresh(member)
    await db.refresh(user)
    return _member_out(member, user)


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

    return _member_out(member, user)


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

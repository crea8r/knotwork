"""FastAPI dependencies for JWT authentication and workspace membership checks."""
from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import User
from .service import decode_access_token, get_user_by_id
from libs.config import settings
from libs.database import get_db
from modules.admin.backend.workspaces_models import WorkspaceMember

_bearer = HTTPBearer(auto_error=False)

_UNAUTH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)
_FORBIDDEN = HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


async def _default_local_user(db: AsyncSession) -> User | None:
    bypass_id: str = getattr(settings, "auth_dev_bypass_user_id", "")
    if bypass_id:
        try:
            user = await get_user_by_id(db, UUID(bypass_id))
            if user is not None:
                return user
        except ValueError:
            pass

    result = await db.execute(select(User).order_by(User.created_at).limit(1))
    return result.scalar_one_or_none()


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and verify the JWT from the Authorization header.

    Localhost auto-bypass: when frontend_url is localhost and no credentials are
    supplied, authenticate as the first user in the DB. This lets single-tenant
    dev installs auto-sign-in without any configuration.

    Dev bypass: if AUTH_DEV_BYPASS_USER_ID is set in config, skip JWT verification
    and return that user directly. This keeps integration tests working without tokens.
    """
    if creds is not None:
        payload = decode_access_token(creds.credentials)
        if payload is not None:
            user_id_str: str | None = payload.get("sub")
            if user_id_str:
                try:
                    user = await get_user_by_id(db, UUID(user_id_str))
                except ValueError:
                    user = None
                if user is not None:
                    return user
        if not settings.is_local_app:
            raise _UNAUTH

    if settings.is_local_app:
        user = await _default_local_user(db)
        if user is not None:
            return user

    bypass_id: str = getattr(settings, "auth_dev_bypass_user_id", "")
    if bypass_id:
        try:
            user = await get_user_by_id(db, UUID(bypass_id))
            if user is not None:
                return user
        except ValueError:
            pass

    raise _UNAUTH


async def get_workspace_member(
    workspace_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceMember:
    """Require the current user to be a member of the specified workspace.

    Dev bypass: if AUTH_DEV_BYPASS_USER_ID is set and this is the bypass user,
    return a synthetic owner membership for any workspace so the bypass user can
    operate regardless of which workspace the DB seed or bootstrap created.
    """
    bypass_id: str = getattr(settings, "auth_dev_bypass_user_id", "")
    if bypass_id and str(user.id) == bypass_id:
        return WorkspaceMember(
            workspace_id=workspace_id,
            user_id=user.id,
            role="owner",
        )

    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.access_disabled_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise _FORBIDDEN
    return member


async def require_owner(
    member: WorkspaceMember = Depends(get_workspace_member),
) -> WorkspaceMember:
    """Require the current user to be an owner of the workspace."""
    if member.role != "owner":
        raise _FORBIDDEN
    return member

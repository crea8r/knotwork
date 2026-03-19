"""FastAPI dependencies for JWT authentication and workspace membership checks."""
from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from knotwork.auth.models import User
from knotwork.auth.service import decode_access_token, get_user_by_id
from knotwork.config import settings
from knotwork.database import get_db
from knotwork.workspaces.models import WorkspaceMember

_bearer = HTTPBearer(auto_error=False)

_UNAUTH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)
_FORBIDDEN = HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and verify the JWT from the Authorization header.

    Dev bypass: if AUTH_DEV_BYPASS_USER_ID is set in config, skip JWT verification
    and return that user directly. This keeps integration tests working without tokens.
    """
    bypass_id: str = getattr(settings, "auth_dev_bypass_user_id", "")
    if bypass_id:
        try:
            user = await get_user_by_id(db, UUID(bypass_id))
            if user is not None:
                return user
        except ValueError:
            # Ignore malformed dev bypass config and continue with normal JWT auth.
            pass

    if creds is None:
        raise _UNAUTH
    payload = decode_access_token(creds.credentials)
    if payload is None:
        raise _UNAUTH
    user_id_str: str | None = payload.get("sub")
    if not user_id_str:
        raise _UNAUTH
    try:
        user = await get_user_by_id(db, UUID(user_id_str))
    except ValueError:
        raise _UNAUTH
    if user is None:
        raise _UNAUTH
    return user


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

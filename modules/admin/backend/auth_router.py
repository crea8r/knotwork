"""Auth endpoints: password + magic-link login, password reset, current user."""
from __future__ import annotations

from html import escape
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from libs.config import settings
from libs.database import get_db
from modules.communication.backend.notification_channels.email import send as send_email
from libs.auth.backend import service
from libs.auth.backend.deps import get_current_user, get_workspace_member
from libs.auth.backend.models import User
from .workspaces_models import Workspace, WorkspaceMember

router = APIRouter(prefix="/auth", tags=["auth"])


class AgentChallengeRequest(BaseModel):
    public_key: str = Field(..., description="Agent's ed25519 public key (base64url)")


class AgentChallengeResponse(BaseModel):
    nonce: str
    expires_at: str


class AgentTokenRequest(BaseModel):
    public_key: str
    nonce: str
    signature: str = Field(..., description="base64url(ed25519_sign(private_key, nonce.encode()))")


class MagicLinkRequest(BaseModel):
    email: EmailStr


class PasswordLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=4, max_length=200)


class ChangePasswordRequest(BaseModel):
    current_password: str | None = Field(default=None, max_length=200)
    new_password: str = Field(..., min_length=4, max_length=200)


class MagicLinkVerifyRequest(BaseModel):
    token: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: str | None = None
    name: str
    bio: str | None = None
    avatar_url: str | None = None
    must_change_password: bool = False


class UpdateMeRequest(BaseModel):
    name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None


class LocalhostSwitchUserRequest(BaseModel):
    user_id: str


class LocalhostSwitchUserResponse(BaseModel):
    detail: str
    email: str


def _workspace_email_from(workspace: Workspace) -> str:
    return (workspace.email_from or settings.email_from).strip() or settings.email_from


def _magic_link_email_content(login_url: str) -> tuple[str, str]:
    safe_url = escape(login_url, quote=True)
    text_body = (
        "Sign in to Knotwork\n\n"
        "Use the link below to securely sign in to your workspace. "
        "This link expires in 15 minutes.\n\n"
        f"{login_url}\n\n"
        "If you did not request this email, you can safely ignore it."
    )
    html_body = f"""\
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e6ebf2;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:36px 36px 16px 36px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5b6b84;">Knotwork</div>
                <h1 style="margin:12px 0 12px 0;font-size:28px;line-height:1.2;color:#172033;">Sign in to your workspace</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#445066;">
                  Use the secure sign-in link below to access Knotwork. This link expires in 15 minutes.
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td>
                      <a href="{safe_url}" style="display:inline-block;background:#172033;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 22px;border-radius:10px;">
                        Open Knotwork
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 10px 0;font-size:14px;line-height:1.6;color:#667389;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.7;word-break:break-all;color:#445066;">
                  <a href="{safe_url}" style="color:#335caa;text-decoration:none;">{safe_url}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 36px 32px 36px;">
                <div style="height:1px;background:#e6ebf2;margin-bottom:18px;"></div>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#7b879b;">
                  If you did not request this email, you can safely ignore it.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
    return text_body, html_body


def _password_reset_email_content(reset_url: str) -> tuple[str, str]:
    safe_url = escape(reset_url, quote=True)
    text_body = (
        "Reset your Knotwork password\n\n"
        "Use the link below to choose a new password. "
        "This link expires in 30 minutes.\n\n"
        f"{reset_url}\n\n"
        "If you did not request this email, you can safely ignore it."
    )
    html_body = f"""\
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e6ebf2;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:36px 36px 16px 36px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#5b6b84;">Knotwork</div>
                <h1 style="margin:12px 0 12px 0;font-size:28px;line-height:1.2;color:#172033;">Reset your password</h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#445066;">
                  Use the secure link below to choose a new Knotwork password. This link expires in 30 minutes.
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td>
                      <a href="{safe_url}" style="display:inline-block;background:#172033;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 22px;border-radius:10px;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 10px 0;font-size:14px;line-height:1.6;color:#667389;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:13px;line-height:1.7;word-break:break-all;color:#445066;">
                  <a href="{safe_url}" style="color:#335caa;text-decoration:none;">{safe_url}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 36px 32px 36px;">
                <div style="height:1px;background:#e6ebf2;margin-bottom:18px;"></div>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#7b879b;">
                  If you did not request this email, you can safely ignore it.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
    return text_body, html_body


async def _has_active_workspace_membership(db: AsyncSession, user_id: UUID) -> bool:
    result = await db.execute(
        select(WorkspaceMember.id)
        .where(
            WorkspaceMember.user_id == user_id,
            WorkspaceMember.access_disabled_at.is_(None),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


@router.post("/password-login", response_model=TokenResponse)
async def password_login(
    req: PasswordLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    user = await service.authenticate_user_by_password(db, req.email, req.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access disabled. Ask your workspace owner to re-enable your membership.",
        )
    return TokenResponse(access_token=service.create_access_token(user.id))


@router.post("/agent-challenge", response_model=AgentChallengeResponse, status_code=201)
async def request_agent_challenge(
    req: AgentChallengeRequest,
    db: AsyncSession = Depends(get_db),
) -> AgentChallengeResponse:
    """Step 1 of agent auth: request a nonce to sign with the agent's ed25519 private key."""
    user = await service.get_user_by_public_key(db, req.public_key)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No agent account for this public key")
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access disabled")
    nonce, expires_at = await service.create_agent_challenge(db, req.public_key)
    await db.commit()
    return AgentChallengeResponse(nonce=nonce, expires_at=expires_at.isoformat())


@router.post("/agent-token", response_model=TokenResponse)
async def verify_agent_token(
    req: AgentTokenRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Step 2 of agent auth: submit signed nonce, receive a JWT bearer token."""
    user = await service.verify_agent_challenge(db, req.public_key, req.nonce, req.signature)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid challenge response")
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access disabled")
    await db.commit()
    return TokenResponse(access_token=service.create_access_token(user.id))


@router.post("/magic-link-request", status_code=202)
async def request_magic_link(
    req: MagicLinkRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send a magic link login email to an existing user.

    Returns 404 if the email is not registered — the user needs an invitation first.
    """
    email = req.email.lower().strip()
    user = await service.get_user_by_email(db, email)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found for this email. Ask your workspace owner for an invitation.",
        )
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access disabled. Ask your workspace owner to re-enable your membership.",
        )

    token_str = await service.create_magic_link_token(db, user)
    await db.commit()

    login_url = f"{settings.normalized_frontend_url}/accept-invite?magic={token_str}"
    body, body_html = _magic_link_email_content(login_url)
    try:
        await send_email(
            to_address=email,
            subject="Sign in to Knotwork",
            body=body,
            body_html=body_html,
            from_address=settings.email_from,
        )
    except Exception as exc:
        logger.error("Magic link email failed for %s: %s", email, exc)

    return {"detail": "If that email is registered, a link has been sent."}


@router.post("/magic-link-verify", response_model=TokenResponse)
async def verify_magic_link(
    req: MagicLinkVerifyRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Exchange a magic link token for a JWT access token."""
    user = await service.consume_magic_link_token(db, req.token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Magic link is invalid or has expired",
        )
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access disabled. Ask your workspace owner to re-enable your membership.",
        )
    await db.commit()
    return TokenResponse(access_token=service.create_access_token(user.id))


@router.post("/password-reset-request", status_code=202)
async def request_password_reset(
    req: PasswordResetRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    email = req.email.lower().strip()
    user = await service.get_user_by_email(db, email)
    if user is not None and await _has_active_workspace_membership(db, user.id):
        token_str = await service.create_password_reset_token(db, user)
        await db.commit()
        reset_url = f"{settings.normalized_frontend_url}/login?reset={token_str}"
        body, body_html = _password_reset_email_content(reset_url)
        try:
            await send_email(
                to_address=email,
                subject="Reset your Knotwork password",
                body=body,
                body_html=body_html,
                from_address=settings.email_from,
            )
        except Exception as exc:
            logger.error("Password reset email failed for %s: %s", email, exc)
    return {"detail": "If that email is registered, a password reset link has been sent."}


@router.post("/password-reset-confirm", response_model=TokenResponse)
async def confirm_password_reset(
    req: PasswordResetConfirmRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    user = await service.consume_password_reset_token(db, req.token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password reset link is invalid or has expired",
        )
    if not await _has_active_workspace_membership(db, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access disabled. Ask your workspace owner to re-enable your membership.",
        )
    try:
        service.set_user_password(user, req.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    await db.commit()
    return TokenResponse(access_token=service.create_access_token(user.id))


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        bio=user.bio,
        avatar_url=user.avatar_url,
        must_change_password=bool(user.must_change_password),
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    """Return the current authenticated user."""
    return _user_out(user)


@router.patch("/me", response_model=UserOut)
async def update_me(
    req: UpdateMeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    """Update the current user's profile (name, bio, avatar_url)."""
    if req.name is not None:
        user.name = req.name.strip() or user.name
    if req.bio is not None:
        user.bio = req.bio.strip() or None
    if req.avatar_url is not None:
        user.avatar_url = req.avatar_url.strip() or None
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_out(user)


@router.post("/change-password", response_model=UserOut)
async def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    if service.password_is_usable(user.hashed_password):
        if not req.current_password or not service.verify_password(req.current_password, user.hashed_password):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")
    try:
        service.set_user_password(user, req.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_out(user)


@router.post(
    "/localhost/workspaces/{workspace_id}/switch-user-request",
    response_model=LocalhostSwitchUserResponse,
    status_code=202,
)
async def request_localhost_switch_user(
    workspace_id: str,
    req: LocalhostSwitchUserRequest,
    _member: WorkspaceMember = Depends(get_workspace_member),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LocalhostSwitchUserResponse:
    if not settings.is_local_app:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    try:
        workspace_uuid = UUID(workspace_id)
        target_user_id = UUID(req.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid id") from exc

    workspace = await db.get(Workspace, workspace_uuid)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if not (workspace.resend_api_key or "").strip():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Workspace email is not configured.",
        )

    member_count = await db.scalar(
        select(func.count()).where(
            WorkspaceMember.workspace_id == workspace_uuid,
            WorkspaceMember.access_disabled_at.is_(None),
        )
    )
    if (member_count or 0) < 2:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Localhost switching requires at least two workspace members.",
        )

    target_row = await db.execute(
        select(User)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(
            WorkspaceMember.workspace_id == workspace_uuid,
            WorkspaceMember.access_disabled_at.is_(None),
            User.id == target_user_id,
        )
        .limit(1)
    )
    target_user = target_row.scalar_one_or_none()
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in workspace")
    if not (target_user.email or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target user has no email")

    token_str = await service.create_magic_link_token(db, target_user)
    await db.commit()

    login_url = f"{settings.normalized_frontend_url}/accept-invite?magic={token_str}"
    body = (
        f"Click the link below to switch into the Knotwork localhost session for {workspace.name}.\n\n"
        f"{login_url}\n\n"
        f"The link expires in 15 minutes."
    )
    try:
        await send_email(
            to_address=target_user.email,
            subject=f"Switch user for {workspace.name}",
            body=body,
            from_address=_workspace_email_from(workspace),
            api_key=workspace.resend_api_key,
        )
    except Exception as exc:
        logger.error("Localhost switch email failed for %s: %s", target_user.email, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Switch email could not be delivered.",
        ) from exc

    return LocalhostSwitchUserResponse(
        detail="Magic link sent.",
        email=target_user.email,
    )


@router.post("/logout", status_code=204)
async def logout() -> None:
    """Logout is client-side: discard the JWT. Server-side is a no-op."""

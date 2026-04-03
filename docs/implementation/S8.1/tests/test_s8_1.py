"""
S8.1 automated tests — Early Adopter Sharing.

Covers:
  - JWT create/decode roundtrip
  - Invalid / tampered token rejected
  - Magic link token creation
  - Magic link token consumption (valid, re-used, expired, not found)
  - Auth dependency edge cases (malformed JWT, deleted user, dev bypass)
  - POST /api/v1/auth/magic-link-request (existing + unknown email)
  - POST /api/v1/auth/magic-link-verify (valid + invalid token)
  - POST /api/v1/auth/magic-link-verify rejects reused token
  - GET /api/v1/auth/me (authenticated)
  - Invitation create → list → verify → accept (happy path + permission/config edges)
  - Invitation accept already-accepted returns 409
  - Invitation accept expired returns 410
  - GET /openclaw-plugin/install with valid token returns install bundle
  - GET /openclaw-plugin/install with invalid token returns 404
  - GET /openclaw-plugin/install with expired token returns 410
  - Handshake persists agent description in DB
  - Handshake with no description stores NULL
"""
from __future__ import annotations

import pytest
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from uuid import UUID, uuid4


@pytest.fixture
def openclaw_plugin_package_url(monkeypatch):
    """Provide a configured external plugin artifact URL for install-bundle tests."""
    from knotwork.config import settings

    url = "https://plugins.example.com/knotwork-bridge-0.2.0.tar.gz"
    monkeypatch.setattr(settings, "openclaw_plugin_package_url", url)
    return url


@pytest.fixture
def invitations_enabled(monkeypatch):
    """Force invitation/email settings into a public-install configuration."""
    from knotwork.config import settings

    async def _send_ok(**_: object) -> None:
        return None

    monkeypatch.setattr(settings, "frontend_url", "https://app.example.com")
    monkeypatch.setattr(settings, "resend_api", "re_test")
    monkeypatch.setattr(settings, "email_from", "noreply@example.com")
    monkeypatch.setattr("knotwork.workspaces.invitations.service.send_email", _send_ok)


# ─────────────────────────────────────────────────────────────────────────────
# 1. JWT service (unit — no DB)
# ─────────────────────────────────────────────────────────────────────────────


def test_create_and_decode_access_token_roundtrip():
    """JWT created for a user_id decodes back to the same sub."""
    from knotwork.auth.service import create_access_token, decode_access_token

    user_id = uuid4()
    token = create_access_token(user_id)
    payload = decode_access_token(token)

    assert payload is not None
    assert payload["sub"] == str(user_id)


def test_decode_invalid_token_returns_none():
    """A garbage string is not a valid JWT."""
    from knotwork.auth.service import decode_access_token

    assert decode_access_token("not.a.token") is None


def test_decode_tampered_token_returns_none():
    """Altering the signature makes the token invalid."""
    from knotwork.auth.service import create_access_token, decode_access_token

    token = create_access_token(uuid4())
    header, payload, signature = token.split(".")
    tampered_signature = ("A" if signature[0] != "A" else "B") + signature[1:]
    tampered = ".".join([header, payload, tampered_signature])
    assert decode_access_token(tampered) is None


def test_access_token_contains_exp_claim():
    """JWT must carry an 'exp' claim for expiry enforcement."""
    from knotwork.auth.service import create_access_token, decode_access_token

    token = create_access_token(uuid4())
    payload = decode_access_token(token)
    assert payload is not None
    assert "exp" in payload


# ─────────────────────────────────────────────────────────────────────────────
# 2. Magic link token service
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_magic_link_token_returns_string(db, user):
    """create_magic_link_token returns a non-empty string."""
    from knotwork.auth.service import create_magic_link_token

    token = await create_magic_link_token(db, user)
    assert isinstance(token, str)
    assert len(token) > 20


@pytest.mark.asyncio
async def test_create_magic_link_tokens_are_unique(db, user):
    """Two tokens minted for the same user must be different."""
    from knotwork.auth.service import create_magic_link_token

    t1 = await create_magic_link_token(db, user)
    t2 = await create_magic_link_token(db, user)
    assert t1 != t2


@pytest.mark.asyncio
async def test_consume_magic_link_token_returns_user(db, user):
    """Consuming a valid token returns the corresponding User."""
    from knotwork.auth.service import create_magic_link_token, consume_magic_link_token

    token = await create_magic_link_token(db, user)
    await db.commit()

    result = await consume_magic_link_token(db, token)
    assert result is not None
    assert result.id == user.id


@pytest.mark.asyncio
async def test_consume_magic_link_token_marks_used(db, user):
    """A consumed token cannot be consumed a second time."""
    from knotwork.auth.service import create_magic_link_token, consume_magic_link_token

    token = await create_magic_link_token(db, user)
    await db.commit()

    first = await consume_magic_link_token(db, token)
    assert first is not None
    await db.commit()

    # Second consumption must return None
    result = await consume_magic_link_token(db, token)
    assert result is None


@pytest.mark.asyncio
async def test_consume_expired_magic_link_token_returns_none(db, user):
    """An expired (past expires_at) token is rejected."""
    from knotwork.auth.models import UserMagicToken
    from knotwork.auth.service import consume_magic_link_token
    import secrets

    token_str = secrets.token_urlsafe(32)
    expired_row = UserMagicToken(
        user_id=user.id,
        token=token_str,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        used=False,
    )
    db.add(expired_row)
    await db.commit()

    result = await consume_magic_link_token(db, token_str)
    assert result is None


@pytest.mark.asyncio
async def test_consume_nonexistent_magic_link_token_returns_none(db):
    """A token that was never created returns None."""
    from knotwork.auth.service import consume_magic_link_token

    result = await consume_magic_link_token(db, "totally-made-up-token")
    assert result is None


@pytest.mark.asyncio
async def test_get_or_create_user_normalizes_email_and_does_not_duplicate(db):
    """Email lookup should be case/whitespace insensitive for upsert behavior."""
    from knotwork.auth.service import get_or_create_user

    user1, created1 = await get_or_create_user(db, "  Alice@Example.com  ", "Alice")
    user2, created2 = await get_or_create_user(db, "alice@example.com", "Alice Two")

    assert created1 is True
    assert created2 is False
    assert user1.id == user2.id
    assert user1.email == "alice@example.com"


# ─────────────────────────────────────────────────────────────────────────────
# 3. Auth dependency + endpoints — routes are at /api/v1/auth/...
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_current_user_dev_bypass_returns_configured_user_without_token(db, user, monkeypatch):
    """AUTH_DEV_BYPASS_USER_ID should bypass JWT auth when it points to a real user."""
    from knotwork.auth.deps import get_current_user
    from knotwork.config import settings

    monkeypatch.setattr(settings, "auth_dev_bypass_user_id", str(user.id))
    result = await get_current_user(creds=None, db=db)
    assert result.id == user.id


@pytest.mark.asyncio
async def test_get_current_user_invalid_dev_bypass_falls_back_to_normal_auth(db, monkeypatch):
    """Malformed bypass ids must not accidentally authenticate requests."""
    from knotwork.auth.deps import get_current_user
    from knotwork.config import settings

    monkeypatch.setattr(settings, "auth_dev_bypass_user_id", "not-a-uuid")
    with pytest.raises(HTTPException) as exc:
        await get_current_user(creds=None, db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_get_current_user_token_for_deleted_user_returns_401(db, user):
    """A valid JWT whose user no longer exists must be rejected."""
    from knotwork.auth.deps import get_current_user
    from knotwork.auth.service import create_access_token
    from fastapi.security import HTTPAuthorizationCredentials

    token = create_access_token(user.id)
    await db.delete(user)
    await db.commit()

    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    with pytest.raises(HTTPException) as exc:
        await get_current_user(creds=creds, db=db)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_magic_link_request_existing_user_returns_202(client, user):
    """POST /api/v1/auth/magic-link-request for a known email returns 202."""
    resp = await client.post(
        "/api/v1/auth/magic-link-request", json={"email": user.email}
    )
    assert resp.status_code == 202


@pytest.mark.asyncio
async def test_magic_link_request_unknown_email_returns_404(client):
    """POST /api/v1/auth/magic-link-request for an unknown email returns 404."""
    resp = await client.post(
        "/api/v1/auth/magic-link-request", json={"email": "nobody@example.com"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_magic_link_request_normalizes_email_input(client, user):
    """Known users should be found even if the email casing/whitespace differs."""
    resp = await client.post(
        "/api/v1/auth/magic-link-request", json={"email": f"  {user.email.upper()}  "}
    )
    assert resp.status_code == 202


@pytest.mark.asyncio
async def test_magic_link_verify_valid_token_returns_access_token(client, db, user):
    """POST /api/v1/auth/magic-link-verify with a valid token returns a JWT."""
    from knotwork.auth.service import create_magic_link_token

    token = await create_magic_link_token(db, user)
    await db.commit()

    resp = await client.post(
        "/api/v1/auth/magic-link-verify", json={"token": token}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_magic_link_verify_invalid_token_returns_401(client):
    """POST /api/v1/auth/magic-link-verify with a bogus token returns 401."""
    resp = await client.post(
        "/api/v1/auth/magic-link-verify", json={"token": "bogus-token-xyz"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_magic_link_verify_reused_token_returns_401(client, db, user):
    """A magic link token must be single-use at the API layer too."""
    from knotwork.auth.service import create_magic_link_token

    token = await create_magic_link_token(db, user)
    await db.commit()

    first = await client.post("/api/v1/auth/magic-link-verify", json={"token": token})
    second = await client.post("/api/v1/auth/magic-link-verify", json={"token": token})

    assert first.status_code == 200
    assert second.status_code == 401


@pytest.mark.asyncio
async def test_auth_me_returns_current_user(client, db, user):
    """GET /api/v1/auth/me with a valid Bearer token returns the user's profile."""
    from knotwork.auth.service import create_access_token

    token = create_access_token(user.id)
    resp = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == user.email
    assert data["name"] == user.name


@pytest.mark.asyncio
async def test_auth_me_without_token_returns_401(client):
    """GET /api/v1/auth/me without Authorization returns 401."""
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_auth_me_with_malformed_bearer_token_returns_401(client):
    """Malformed bearer tokens should not reach user resolution."""
    resp = await client.get(
        "/api/v1/auth/me", headers={"Authorization": "Bearer definitely-not-a-jwt"}
    )
    assert resp.status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# 4. Invitation service (direct, bypasses HTTP auth)
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_invitation_saves_row(db, workspace, user, invitations_enabled):
    """create_invitation persists a WorkspaceInvitation row."""
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation, list_invitations

    req = CreateInvitationRequest(email="friend@example.com", role="operator")
    out = await create_invitation(db, workspace.id, user.id, req)

    assert out.email == "friend@example.com"
    assert out.role == "operator"

    all_invs = await list_invitations(db, workspace.id)
    assert any(i.email == "friend@example.com" for i in all_invs)


@pytest.mark.asyncio
async def test_invitation_token_hint_is_last_6_chars(db, workspace, user, invitations_enabled):
    """token_hint must be exactly the last 6 characters of the token."""
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    from sqlalchemy import select

    req = CreateInvitationRequest(email="hint@example.com", role="operator")
    out = await create_invitation(db, workspace.id, user.id, req)

    row = (
        await db.execute(
            select(WorkspaceInvitation).where(WorkspaceInvitation.email == "hint@example.com")
        )
    ).scalar_one()

    assert out.token_hint == row.token[-6:]


@pytest.mark.asyncio
async def test_get_invitation_by_token_valid(db, workspace, user, invitations_enabled):
    """get_invitation_by_token returns workspace name + role for a valid token."""
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation, get_invitation_by_token
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    from sqlalchemy import select

    req = CreateInvitationRequest(email="verify@example.com", role="owner")
    await create_invitation(db, workspace.id, user.id, req)

    row = (
        await db.execute(
            select(WorkspaceInvitation).where(WorkspaceInvitation.email == "verify@example.com")
        )
    ).scalar_one()

    out = await get_invitation_by_token(db, row.token)
    assert out.email == "verify@example.com"
    assert out.workspace_name == workspace.name
    assert out.role == "owner"
    assert out.already_accepted is False


@pytest.mark.asyncio
async def test_accept_invitation_creates_user_and_member(db, workspace, user, invitations_enabled):
    """accept_invitation creates a User + WorkspaceMember and returns a JWT."""
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation, accept_invitation
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    from knotwork.auth.service import decode_access_token
    from knotwork.workspaces.models import WorkspaceMember
    from sqlalchemy import select

    req = CreateInvitationRequest(email="newbie@example.com", role="operator")
    await create_invitation(db, workspace.id, user.id, req)

    row = (
        await db.execute(
            select(WorkspaceInvitation).where(WorkspaceInvitation.email == "newbie@example.com")
        )
    ).scalar_one()

    out = await accept_invitation(db, row.token, "New User")

    assert out.email == "newbie@example.com"
    assert out.name == "New User"
    assert out.workspace_id == workspace.id

    payload = decode_access_token(out.access_token)
    assert payload is not None
    assert payload["sub"] == str(out.user_id)

    member = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id,
                WorkspaceMember.user_id == out.user_id,
            )
        )
    ).scalar_one_or_none()
    assert member is not None
    assert member.role == "operator"


@pytest.mark.asyncio
async def test_accept_invitation_already_accepted_raises_409(db, workspace, user, invitations_enabled):
    """Accepting an already-accepted invitation raises HTTP 409."""
    from fastapi import HTTPException
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation, accept_invitation
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    from sqlalchemy import select

    req = CreateInvitationRequest(email="double@example.com", role="operator")
    await create_invitation(db, workspace.id, user.id, req)

    row = (
        await db.execute(
            select(WorkspaceInvitation).where(WorkspaceInvitation.email == "double@example.com")
        )
    ).scalar_one()

    await accept_invitation(db, row.token, "Double User")

    with pytest.raises(HTTPException) as exc_info:
        await accept_invitation(db, row.token, "Double Again")

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_accept_expired_invitation_raises_410(db, workspace, user):
    """Accepting an expired invitation raises HTTP 410."""
    from fastapi import HTTPException
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    from knotwork.workspaces.invitations.service import accept_invitation
    import secrets

    token_str = secrets.token_urlsafe(32)
    expired_inv = WorkspaceInvitation(
        workspace_id=workspace.id,
        invited_by_user_id=user.id,
        email="expired@example.com",
        role="operator",
        token=token_str,
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    db.add(expired_inv)
    await db.commit()

    with pytest.raises(HTTPException) as exc_info:
        await accept_invitation(db, token_str, "Ghost User")

    assert exc_info.value.status_code == 410


@pytest.mark.asyncio
async def test_create_invitation_disabled_on_localhost_install(db, workspace, user, monkeypatch):
    """Localhost installs with no email delivery must reject invite creation."""
    from knotwork.config import settings
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation

    monkeypatch.setattr(settings, "frontend_url", "http://localhost:3000")
    monkeypatch.setattr(settings, "resend_api", "")
    monkeypatch.setattr(settings, "email_from", "")

    with pytest.raises(HTTPException) as exc:
        await create_invitation(
            db,
            workspace.id,
            user.id,
            CreateInvitationRequest(email="blocked@example.com", role="operator"),
        )

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_create_invitation_email_failure_returns_502(db, workspace, user, monkeypatch):
    """Public installs should fail fast if invite delivery fails."""
    from knotwork.config import settings
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation

    async def _boom(**_: object) -> None:
        raise RuntimeError("smtp broken")

    monkeypatch.setattr(settings, "frontend_url", "https://app.example.com")
    monkeypatch.setattr(settings, "resend_api", "re_test")
    monkeypatch.setattr(settings, "email_from", "noreply@example.com")
    monkeypatch.setattr("knotwork.workspaces.invitations.service.send_email", _boom)

    with pytest.raises(HTTPException) as exc:
        await create_invitation(
            db,
            workspace.id,
            user.id,
            CreateInvitationRequest(email="broken@example.com", role="operator"),
        )

    assert exc.value.status_code == 502


# ─────────────────────────────────────────────────────────────────────────────
# 5. Invitation API endpoints (HTTP layer)
#    Protected routes need JWT + WorkspaceMember(role=owner).
#    Public routes need only the invitation token.
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_invitations_empty(client, workspace, user, workspace_member, invitations_enabled):
    """GET /api/v1/workspaces/{id}/invitations returns empty list when none exist."""
    from knotwork.auth.service import create_access_token

    jwt = create_access_token(user.id)
    resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/invitations",
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_invitation_via_api(client, workspace, user, workspace_member, invitations_enabled):
    """POST /api/v1/workspaces/{id}/invitations creates an invitation (owner only)."""
    from knotwork.auth.service import create_access_token

    jwt = create_access_token(user.id)
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/invitations",
        json={"email": "api-invite@example.com", "role": "operator"},
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert resp.status_code == 200  # Router default; no status_code=201 declared
    data = resp.json()
    assert data["email"] == "api-invite@example.com"
    assert data["role"] == "operator"
    assert "token_hint" in data
    assert len(data["token_hint"]) == 6


@pytest.mark.asyncio
async def test_create_invitation_api_rejects_non_member(client, db, workspace, user, invitations_enabled):
    """Workspace routes should reject users outside the workspace."""
    from knotwork.auth.models import User
    from knotwork.auth.service import create_access_token

    outsider = User(email="outsider@example.com", name="Outsider", hashed_password="!no-password")
    db.add(outsider)
    await db.commit()

    token = create_access_token(outsider.id)
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/invitations",
        json={"email": "api-invite@example.com", "role": "operator"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_invitation_api_rejects_operator_role(client, db, workspace, user, invitations_enabled):
    """Only owners may create invitations."""
    from knotwork.auth.models import User
    from knotwork.auth.service import create_access_token
    from knotwork.workspaces.models import WorkspaceMember

    operator = User(email="operator@example.com", name="Operator", hashed_password="!no-password")
    db.add(operator)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=operator.id, role="operator"))
    await db.commit()

    jwt = create_access_token(operator.id)
    resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/invitations",
        json={"email": "api-invite@example.com", "role": "operator"},
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_public_verify_invitation_endpoint(client, db, workspace, user, invitations_enabled):
    """GET /api/v1/auth/invitations/{token} returns workspace name + email."""
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    from sqlalchemy import select

    req = CreateInvitationRequest(email="public-verify@example.com", role="operator")
    await create_invitation(db, workspace.id, user.id, req)

    row = (
        await db.execute(
            select(WorkspaceInvitation).where(
                WorkspaceInvitation.email == "public-verify@example.com"
            )
        )
    ).scalar_one()

    resp = await client.get(f"/api/v1/auth/invitations/{row.token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "public-verify@example.com"
    assert data["workspace_name"] == workspace.name
    assert data["already_accepted"] is False


@pytest.mark.asyncio
async def test_public_verify_invitation_invalid_token_returns_404(client):
    """Unknown invite tokens should not leak any information."""
    resp = await client.get("/api/v1/auth/invitations/not-a-real-token")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_public_verify_expired_invitation_returns_410(client, db, workspace, user):
    """Expired invites should be reported as expired before acceptance."""
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    import secrets

    token_str = secrets.token_urlsafe(32)
    db.add(WorkspaceInvitation(
        workspace_id=workspace.id,
        invited_by_user_id=user.id,
        email="expired-verify@example.com",
        role="operator",
        token=token_str,
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
    ))
    await db.commit()

    resp = await client.get(f"/api/v1/auth/invitations/{token_str}")
    assert resp.status_code == 410


@pytest.mark.asyncio
async def test_public_accept_invitation_endpoint(client, db, workspace, user, invitations_enabled):
    """POST /api/v1/auth/invitations/{token}/accept creates account and returns JWT."""
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    from sqlalchemy import select

    req = CreateInvitationRequest(email="acceptme@example.com", role="operator")
    await create_invitation(db, workspace.id, user.id, req)

    row = (
        await db.execute(
            select(WorkspaceInvitation).where(WorkspaceInvitation.email == "acceptme@example.com")
        )
    ).scalar_one()

    resp = await client.post(
        f"/api/v1/auth/invitations/{row.token}/accept", json={"name": "New Member"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["email"] == "acceptme@example.com"
    assert data["name"] == "New Member"


@pytest.mark.asyncio
async def test_public_accept_invitation_already_accepted_returns_409(client, db, workspace, user, invitations_enabled):
    """POST /api/v1/auth/invitations/{token}/accept for an already accepted invite returns 409."""
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    from sqlalchemy import select

    req = CreateInvitationRequest(email="double2@example.com", role="operator")
    await create_invitation(db, workspace.id, user.id, req)

    row = (
        await db.execute(
            select(WorkspaceInvitation).where(WorkspaceInvitation.email == "double2@example.com")
        )
    ).scalar_one()

    await client.post(
        f"/api/v1/auth/invitations/{row.token}/accept", json={"name": "Once"}
    )
    resp = await client.post(
        f"/api/v1/auth/invitations/{row.token}/accept", json={"name": "Twice"}
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_public_verify_invitation_reports_already_accepted(client, db, workspace, user, invitations_enabled):
    """Verification endpoint should surface that an invite has already been accepted."""
    from knotwork.workspaces.invitations.schemas import CreateInvitationRequest
    from knotwork.workspaces.invitations.service import create_invitation
    from knotwork.workspaces.invitations.models import WorkspaceInvitation
    from sqlalchemy import select

    req = CreateInvitationRequest(email="accepted@example.com", role="operator")
    await create_invitation(db, workspace.id, user.id, req)
    row = (
        await db.execute(
            select(WorkspaceInvitation).where(WorkspaceInvitation.email == "accepted@example.com")
        )
    ).scalar_one()
    await client.post(f"/api/v1/auth/invitations/{row.token}/accept", json={"name": "Accepted User"})

    resp = await client.get(f"/api/v1/auth/invitations/{row.token}")
    assert resp.status_code == 200
    assert resp.json()["already_accepted"] is True


# ─────────────────────────────────────────────────────────────────────────────
# 6. OpenClaw plugin install endpoint
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_create_handshake_token_missing_workspace_returns_404(db):
    """Service should reject handshake token creation for a non-existent workspace."""
    from knotwork.openclaw_integrations.schemas import HandshakeTokenCreateRequest
    from knotwork.openclaw_integrations.service import create_handshake_token

    with pytest.raises(HTTPException) as exc:
        await create_handshake_token(db, uuid4(), HandshakeTokenCreateRequest())

    assert exc.value.status_code == 404
    assert exc.value.detail == "Workspace not found"


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_create_handshake_token_route_requires_owner(client, workspace):
    """Handshake token route should be owner-protected like other workspace settings."""
    resp = await client.post(f"/api/v1/workspaces/{workspace.id}/openclaw/handshake-token", json={})
    assert resp.status_code == 401


async def _create_handshake_token(db, workspace, expired: bool = False) -> str:
    """Helper: seed a handshake token row directly (bypasses API auth)."""
    from knotwork.openclaw_integrations.models import OpenClawHandshakeToken
    import secrets

    token_str = f"kw_oc_{secrets.token_urlsafe(24)}"
    if expired:
        expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    else:
        expires_at = datetime.now(timezone.utc) + timedelta(days=365)

    row = OpenClawHandshakeToken(
        id=uuid4(),
        workspace_id=workspace.id,
        token=token_str,
        expires_at=expires_at,
    )
    db.add(row)
    await db.commit()
    return token_str


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_install_endpoint_valid_token_returns_bundle(client, db, workspace, openclaw_plugin_package_url):
    """GET /openclaw-plugin/install with a valid token returns the install bundle."""
    token = await _create_handshake_token(db, workspace)

    resp = await client.get(f"/openclaw-plugin/install?token={token}")
    assert resp.status_code == 200
    data = resp.json()

    assert "install_command" in data
    assert "download_command" in data
    assert "config_snippet" in data
    assert "instructions" in data
    assert "knotwork_backend_url" in data
    assert "plugin_package" in data
    assert data["plugin_id"] == "knotwork-bridge"
    base_url = data["knotwork_backend_url"]
    assert base_url.startswith("http://")
    assert data["setup_url"].endswith(f"/openclaw-plugin/install?token={token}")
    assert data["plugin_archive_url"] == openclaw_plugin_package_url
    assert data["plugin_package"] == data["plugin_archive_url"]
    assert data["uninstall_command"] == 'openclaw plugins uninstall "knotwork-bridge"'
    assert data["cleanup_command"] == 'rm -rf ~/.openclaw/extensions/knotwork-bridge'
    assert data["local_package_file"] == "knotwork-bridge-0.2.0.tar.gz"
    assert data["download_command"] == 'curl -fLJO "https://plugins.example.com/knotwork-bridge-0.2.0.tar.gz"'
    assert data["install_command"] == 'openclaw plugins install "$(ls -t ./*.tar.gz | head -n 1)"'
    assert data["required_gateway_scopes"] == ["operator.read", "operator.write"]
    assert data["required_config_keys"] == ["knotworkBackendUrl", "handshakeToken"]
    assert data["requires_user_permission_approval"] is True
    assert "config_script" in data["agent_install_policy"].lower() or "openclaw" in data["agent_install_policy"].lower()
    assert data["verification_command"] == "openclaw gateway call knotwork.handshake"
    assert "installation succeeds only if" in data["installation_success_criteria"].lower()
    assert any(
        "operator.write" in condition.lower() or "permissions" in condition.lower() or "scope" in condition.lower()
        for condition in data["installation_failure_conditions"]
    )
    assert any(
        "verification_command" in condition.lower() or "missing-config" in condition.lower()
        for condition in data["installation_failure_conditions"]
    )
    assert "knotwork-bridge" in data["config_snippet"]["plugins"]["entries"]
    assert data["config_snippet"]["plugins"]["entries"]["knotwork-bridge"]["config"]["knotworkBackendUrl"] == base_url
    assert data["token"] == token


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_install_endpoint_bundle_contains_token_in_command(client, db, workspace, openclaw_plugin_package_url):
    """The install bundle must persist the handshake token in plugin config."""
    token = await _create_handshake_token(db, workspace)

    resp = await client.get(f"/openclaw-plugin/install?token={token}")
    assert resp.status_code == 200
    data = resp.json()
    assert token == data["config_snippet"]["plugins"]["entries"]["knotwork-bridge"]["config"]["handshakeToken"]
    assert ".tar.gz" in data["install_command"]


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_install_endpoint_uses_forwarded_host_for_bundle_urls(client, db, workspace, openclaw_plugin_package_url):
    """Install bundle should advertise the externally requested host, not static BACKEND_URL."""
    token = await _create_handshake_token(db, workspace)

    resp = await client.get(
        f"/openclaw-plugin/install?token={token}",
        headers={
            "x-forwarded-proto": "https",
            "x-forwarded-host": "knotwork.example.com",
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["knotwork_backend_url"] == "https://knotwork.example.com"
    assert data["plugin_archive_url"] == openclaw_plugin_package_url


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_install_endpoint_requires_configured_plugin_package_url(client, db, workspace, monkeypatch):
    """Install bundle should fail closed when the plugin artifact URL is not configured."""
    from knotwork.config import settings

    monkeypatch.setattr(settings, "openclaw_plugin_package_url", "")
    token = await _create_handshake_token(db, workspace)

    resp = await client.get(f"/openclaw-plugin/install?token={token}")
    assert resp.status_code == 503
    assert resp.json()["detail"] == "OpenClaw plugin package URL is not configured"


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_install_endpoint_invalid_token_returns_404(client):
    """GET /openclaw-plugin/install with a non-existent token returns 404."""
    resp = await client.get("/openclaw-plugin/install?token=invalid-token-xyz")
    assert resp.status_code == 404


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_install_endpoint_expired_token_returns_410(client, db, workspace):
    """GET /openclaw-plugin/install with an expired token returns 410."""
    token = await _create_handshake_token(db, workspace, expired=True)

    resp = await client.get(f"/openclaw-plugin/install?token={token}")
    assert resp.status_code == 410


# ─────────────────────────────────────────────────────────────────────────────
# 7. Agent description in OpenClaw handshake
# ─────────────────────────────────────────────────────────────────────────────


async def _do_handshake(client, db, workspace, agents: list[dict]) -> dict:
    """Helper: create a fresh handshake token then POST /openclaw-plugin/handshake."""
    token = await _create_handshake_token(db, workspace)
    payload = {
        "token": token,
        "plugin_instance_id": f"test-plugin-{uuid4()}",
        "openclaw_workspace_id": "oc-ws-001",
        "plugin_version": "0.2.0",
        "agents": agents,
    }
    resp = await client.post("/openclaw-plugin/handshake", json=payload)
    assert resp.status_code == 200
    return resp.json()


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_handshake_persists_agent_description(client, db, workspace):
    """Agent description sent in handshake is stored in openclaw_remote_agents."""
    from knotwork.openclaw_integrations.models import OpenClawRemoteAgent
    from sqlalchemy import select

    agents = [
        {
            "remote_agent_id": "agent-001",
            "slug": "research-agent",
            "display_name": "Research Agent",
            "description": "Handles customer research tasks",
            "tools": [],
            "constraints": {},
        }
    ]
    hs = await _do_handshake(client, db, workspace, agents)
    assert hs["synced_agents"] == 1

    row = (
        await db.execute(
            select(OpenClawRemoteAgent).where(OpenClawRemoteAgent.remote_agent_id == "agent-001")
        )
    ).scalar_one_or_none()

    assert row is not None
    assert row.description == "Handles customer research tasks"


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_handshake_description_null_when_not_provided(client, db, workspace):
    """When description is absent from the handshake payload, DB column is NULL."""
    from knotwork.openclaw_integrations.models import OpenClawRemoteAgent
    from sqlalchemy import select

    agents = [
        {
            "remote_agent_id": "agent-002",
            "slug": "no-desc-agent",
            "display_name": "No Description Agent",
            "tools": [],
            "constraints": {},
        }
    ]
    await _do_handshake(client, db, workspace, agents)

    row = (
        await db.execute(
            select(OpenClawRemoteAgent).where(OpenClawRemoteAgent.remote_agent_id == "agent-002")
        )
    ).scalar_one_or_none()

    assert row is not None
    assert row.description is None


@pytest.mark.xfail(reason="superseded by S12.2: OpenClaw module removed")
@pytest.mark.asyncio
async def test_handshake_description_updates_on_second_sync(client, db, workspace):
    """Re-running handshake with an updated description overwrites the old one."""
    from knotwork.openclaw_integrations.models import OpenClawRemoteAgent
    from sqlalchemy import select

    plugin_id = f"update-plugin-{uuid4()}"

    # First handshake — initial description
    token1 = await _create_handshake_token(db, workspace)
    resp1 = await client.post(
        "/openclaw-plugin/handshake",
        json={
            "token": token1,
            "plugin_instance_id": plugin_id,
            "openclaw_workspace_id": "oc-ws-update",
            "plugin_version": "0.2.0",
            "agents": [
                {
                    "remote_agent_id": "agent-003",
                    "slug": "update-agent",
                    "display_name": "Update Agent",
                    "description": "First description",
                    "tools": [],
                    "constraints": {},
                }
            ],
        },
    )
    assert resp1.status_code == 200

    # Second handshake — same plugin_instance_id, updated description
    token2 = await _create_handshake_token(db, workspace)
    resp2 = await client.post(
        "/openclaw-plugin/handshake",
        json={
            "token": token2,
            "plugin_instance_id": plugin_id,
            "openclaw_workspace_id": "oc-ws-update",
            "plugin_version": "0.2.0",
            "agents": [
                {
                    "remote_agent_id": "agent-003",
                    "slug": "update-agent",
                    "display_name": "Update Agent",
                    "description": "Updated description",
                    "tools": [],
                    "constraints": {},
                }
            ],
        },
    )
    assert resp2.status_code == 200

    row = (
        await db.execute(
            select(OpenClawRemoteAgent).where(OpenClawRemoteAgent.remote_agent_id == "agent-003")
        )
    ).scalar_one_or_none()

    assert row is not None
    assert row.description == "Updated description"


# ─────────────────────────────────────────────────────────────────────────────
# 8. Public workflow links + public run pages
# ─────────────────────────────────────────────────────────────────────────────


async def _seed_graph_with_input_schema(db, workspace):
    from knotwork.graphs.models import Graph, GraphVersion

    graph = Graph(
        workspace_id=workspace.id,
        name="Public Demo",
        description="demo",
        status="draft",
    )
    db.add(graph)
    await db.flush()

    version = GraphVersion(
        graph_id=graph.id,
        definition={
            "nodes": [
                {"id": "start", "type": "start", "name": "Start", "config": {}},
                {"id": "end", "type": "end", "name": "End", "config": {}},
            ],
            "edges": [{"id": "e-start-end", "source": "start", "target": "end", "type": "direct"}],
            "input_schema": [
                {"name": "topic", "label": "Topic", "description": "", "required": True, "type": "text"},
            ],
        },
    )
    db.add(version)
    await db.commit()
    await db.refresh(graph)
    await db.refresh(version)
    return graph, version


@pytest.mark.xfail(reason="superseded by S9.1-polish: PublicWorkflowLink table removed; version_slug now lives on GraphVersion; public links managed via POST/DELETE .../versions/{id}/publish")
@pytest.mark.asyncio
async def test_owner_can_create_and_list_public_workflow_links(client, db, workspace, user, workspace_member):
    """Owner can create/list public links for a workflow."""
    from knotwork.auth.service import create_access_token

    graph, version = await _seed_graph_with_input_schema(db, workspace)
    jwt = create_access_token(user.id)

    create_resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/public-links",
        json={"graph_version_id": str(version.id), "description_md": "Public **test** description"},
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    assert created["status"] == "active"
    assert created["graph_version_id"] == str(version.id)

    list_resp = await client.get(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/public-links",
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) == 1
    assert items[0]["description_md"] == "Public **test** description"


@pytest.mark.xfail(reason="superseded by S9.1-polish: PublicWorkflowLink table removed; public trigger now uses version_slug + graph_slug URL pattern")
@pytest.mark.asyncio
async def test_public_workflow_trigger_creates_public_run_page(client, db, workspace, user, workspace_member):
    """Public trigger returns run token and public run endpoint exposes input + final output only."""
    from knotwork.auth.service import create_access_token
    from knotwork.runs.models import Run

    graph, version = await _seed_graph_with_input_schema(db, workspace)
    jwt = create_access_token(user.id)

    create_resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/public-links",
        json={"graph_version_id": str(version.id), "description_md": "Run description"},
        headers={"Authorization": f"Bearer {jwt}"},
    )
    token = create_resp.json()["token"]

    wf_resp = await client.get(f"/api/v1/public/workflows/{token}")
    assert wf_resp.status_code == 200
    wf_data = wf_resp.json()
    assert wf_data["description_md"] == "Run description"
    assert wf_data["input_schema"][0]["name"] == "topic"

    trig_resp = await client.post(
        f"/api/v1/public/workflows/{token}/trigger",
        json={"input": {"topic": "pricing"}},
    )
    assert trig_resp.status_code == 201
    run_token = trig_resp.json()["run_token"]
    run_id = trig_resp.json()["run_id"]

    # Seed final output to validate public rendering contract.
    run = await db.get(Run, run_id)
    assert run is not None
    run.output = {"text": "Final answer"}
    await db.commit()

    run_resp = await client.get(f"/api/v1/public/runs/{run_token}")
    assert run_resp.status_code == 200
    run_data = run_resp.json()
    assert run_data["description_md"] == "Run description"
    assert run_data["input"] == {"topic": "pricing"}
    assert run_data["final_output"] == "Final answer"
    assert run_data["status"] == "completed"


@pytest.mark.xfail(reason="superseded by S9.1-polish: PublicWorkflowLink table removed; token-based rate limiting replaced by slug-based routing")
@pytest.mark.asyncio
async def test_public_trigger_rate_limit_returns_429(client, db, workspace, user, workspace_member):
    """Public trigger endpoint enforces basic per-token/IP rate limits."""
    from knotwork.auth.service import create_access_token

    graph, version = await _seed_graph_with_input_schema(db, workspace)
    jwt = create_access_token(user.id)
    create_resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/public-links",
        json={"graph_version_id": str(version.id), "description_md": "Rate limit test"},
        headers={"Authorization": f"Bearer {jwt}"},
    )
    token = create_resp.json()["token"]

    # default rate limit: 5 requests per 60 seconds
    for _ in range(5):
        resp = await client.post(
            f"/api/v1/public/workflows/{token}/trigger",
            json={"input": {"topic": "rate"}},
        )
        assert resp.status_code == 201

    limited = await client.post(
        f"/api/v1/public/workflows/{token}/trigger",
        json={"input": {"topic": "rate"}},
    )
    assert limited.status_code == 429


@pytest.mark.xfail(reason="superseded by S9.1-polish: PublicWorkflowLink.disable() removed; unpublish clears version_slug instead")
@pytest.mark.asyncio
async def test_disabled_public_link_not_accessible(client, db, workspace, user, workspace_member):
    """Disabled public links return 404 on public workflow endpoint."""
    from knotwork.auth.service import create_access_token

    graph, version = await _seed_graph_with_input_schema(db, workspace)
    jwt = create_access_token(user.id)
    create_resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/public-links",
        json={"graph_version_id": str(version.id), "description_md": "Disable me"},
        headers={"Authorization": f"Bearer {jwt}"},
    )
    link = create_resp.json()

    disable_resp = await client.post(
        f"/api/v1/workspaces/{workspace.id}/graphs/{graph.id}/public-links/{link['id']}/disable",
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert disable_resp.status_code == 200
    assert disable_resp.json()["status"] == "disabled"

    public_resp = await client.get(f"/api/v1/public/workflows/{link['token']}")
    assert public_resp.status_code == 404


@pytest.mark.asyncio
async def test_runtime_completion_copies_current_output_into_run_output(db, workspace):
    """On terminal completion, current_output is persisted to runs.output."""
    from knotwork.graphs.models import Graph, GraphVersion
    from knotwork.runs.models import Run
    from knotwork.runtime.runner import _persist_run_output_from_result

    graph = Graph(workspace_id=workspace.id, name="Output copy", description="d", status="draft")
    db.add(graph)
    await db.flush()
    version = GraphVersion(graph_id=graph.id, definition={"nodes": [], "edges": []})
    db.add(version)
    await db.flush()

    run = Run(
        workspace_id=workspace.id,
        graph_id=graph.id,
        graph_version_id=version.id,
        trigger="manual",
        input={},
        context_files=[],
        status="running",
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    await _persist_run_output_from_result(str(run.id), {"current_output": "Final from state"}, db=db)

    refreshed = await db.get(Run, run.id)
    assert refreshed is not None
    assert refreshed.output == {"text": "Final from state"}


@pytest.mark.xfail(reason="superseded by S9.1-polish: PublicWorkflowLink model removed; PublicRunShare now FKs to graph_version_id instead of public_workflow_id")
@pytest.mark.asyncio
async def test_public_run_aborted_sends_notification_and_marks_notified(db, workspace):
    """Aborted public runs notify subscribed email and set notified_at."""
    from knotwork.graphs.models import Graph, GraphVersion
    from knotwork.public_workflows.models import PublicRunShare, PublicWorkflowLink
    from knotwork.public_workflows.service import notify_public_run_aborted
    from knotwork.runs.models import Run

    graph = Graph(workspace_id=workspace.id, name="Abort notify", description="d", status="draft")
    db.add(graph)
    await db.flush()
    version = GraphVersion(graph_id=graph.id, definition={"nodes": [], "edges": []})
    db.add(version)
    await db.flush()
    run = Run(
        workspace_id=workspace.id,
        graph_id=graph.id,
        graph_version_id=version.id,
        trigger="public",
        input={},
        context_files=[],
        status="stopped",
    )
    db.add(run)
    await db.flush()
    link = PublicWorkflowLink(
        workspace_id=workspace.id,
        graph_id=graph.id,
        graph_version_id=version.id,
        token="kwpubwf_abort_test",
        description_md="desc",
        status="active",
    )
    db.add(link)
    await db.flush()
    share = PublicRunShare(
        workspace_id=workspace.id,
        run_id=run.id,
        public_workflow_id=link.id,
        token="kwpubrun_abort_test",
        description_md="desc",
        email="expert@example.com",
    )
    db.add(share)
    await db.commit()

    await notify_public_run_aborted(db, run.id)

    refreshed = await db.get(PublicRunShare, share.id)
    assert refreshed is not None
    assert refreshed.notified_at is not None

"""
Agent session JWT — scoped to (run_id, node_id, workspace_id).

Tokens are created by the runtime engine at the start of each node execution and
stored in RunNodeState.input so they are visible in the run inspector and testable
via curl without a live agent present.

Token lifetime: 2 hours.  All Agent API endpoints validate with `verify_session_token`.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TypedDict

from jose import JWTError, jwt

_ALGORITHM = "HS256"
_TOKEN_TTL = timedelta(hours=2)


class SessionClaims(TypedDict):
    run_id: str
    node_id: str
    workspace_id: str
    iss: str
    exp: float


def create_session_token(run_id: str, node_id: str, workspace_id: str, secret: str) -> str:
    """Create a session JWT scoped to a single run + node."""
    now = datetime.now(timezone.utc)
    payload: SessionClaims = {
        "run_id": run_id,
        "node_id": node_id,
        "workspace_id": workspace_id,
        "iss": "knotwork",
        "exp": (now + _TOKEN_TTL).timestamp(),
    }
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


def verify_session_token(token: str, secret: str) -> SessionClaims:
    """Decode and validate a session JWT.  Raises ValueError on any failure."""
    try:
        claims = jwt.decode(token, secret, algorithms=[_ALGORITHM])
    except JWTError as exc:
        raise ValueError(f"invalid or expired session token: {exc}") from exc
    if claims.get("iss") != "knotwork":
        raise ValueError("invalid or expired session token: wrong issuer")
    return claims  # type: ignore[return-value]

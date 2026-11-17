"""Resolve a bearer access token to claims whose server session is still live."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apex_backend.auth.jwt_verifier import JwtTokenVerifier
from apex_backend.models import UserSession


@dataclass(frozen=True)
class ActiveSession:
    """A verified access token whose server session is live."""

    actor_id: str
    session_id: str
    claims: dict[str, Any]


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


async def require_active_session(
    token: str, verifier: JwtTokenVerifier, db: AsyncSession
) -> ActiveSession:
    """Return the verified session, or raise 401.

    A signature-valid token is not enough: logout, deactivation and expiry act on
    the session row, so the row must exist, be unrevoked, unexpired and belong to
    the token's actor and tenant.
    """
    access_token = await verifier.verify_token(token)
    if access_token is None:
        raise _unauthorized("Invalid or expired access token.")

    claims = access_token.claims or {}
    actor_id = str(claims.get("sub") or access_token.subject or "").strip()
    session_id = str(claims.get("session_id", "")).strip()
    if not actor_id or not session_id:
        raise _unauthorized("Token missing required claims.")

    db_session = (
        await db.execute(select(UserSession).where(UserSession.session_id == session_id))
    ).scalar_one_or_none()
    if db_session is None:
        raise _unauthorized("Session not found.")
    if not db_session.is_active:
        raise _unauthorized("Session revoked.")
    expires_at = db_session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at <= datetime.now(UTC):
        raise _unauthorized("Session expired.")
    if db_session.actor_id != actor_id:
        raise _unauthorized("Session actor mismatch.")
    tenant_id = str(claims.get("tenant_id", "")).strip()
    if tenant_id and db_session.tenant_id != tenant_id:
        raise _unauthorized("Session tenant mismatch.")
    return ActiveSession(actor_id=actor_id, session_id=session_id, claims=claims)


__all__ = ["ActiveSession", "require_active_session"]

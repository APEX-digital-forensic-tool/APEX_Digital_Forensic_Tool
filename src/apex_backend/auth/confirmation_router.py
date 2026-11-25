"""FastAPI router for confirmation grants: issuance, lookup and one-time consume.

Lookup and consume let an MCP server that runs on the analyst's machine check grants
without a database connection: it forwards the analyst's own bearer token, and the
actor and session always come from that verified token, never from the request body.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from apex_backend.auth.jwt_verifier import JwtTokenVerifier
from apex_backend.auth.schemas import (
    ConfirmationConsumeResponse,
    ConfirmationLookupResponse,
    ConfirmationRequest,
    ConfirmationResponse,
)
from apex_backend.auth.session_guard import ActiveSession, require_active_session
from apex_backend.models import ConfirmationGrantRow
from apex_mcp.frontend_security import (
    _APPROVAL_ROLES,
    _APPROVAL_TOOLS,
    _EXPORT_ROLES,
    _EXPORT_TOOLS,
    _HUMAN_MUTATION_ROLES,
    _RAW_READ_ROLES,
)

router = APIRouter()

_GRANT_TTL_SECONDS = 300  # 5 minutes
_bearer = HTTPBearer()


def _get_jwt_verifier() -> JwtTokenVerifier:
    """Dependency: resolved by the app factory via dependency_overrides."""
    raise NotImplementedError("jwt_verifier dependency not wired.")


def _get_db() -> AsyncSession:
    """Dependency: resolved by the app factory via dependency_overrides."""
    raise NotImplementedError("db dependency not wired.")


@router.post(
    "/confirmations",
    response_model=ConfirmationResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["confirmations"],
)
async def issue_confirmation(
    body: ConfirmationRequest,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),  # noqa: B008
    verifier: JwtTokenVerifier = Depends(_get_jwt_verifier),  # noqa: B008
    db: AsyncSession = Depends(_get_db),  # noqa: B008
) -> ConfirmationResponse:
    """Issue a one-time confirmation grant after a human approval action.

    The actor_id and session_id are extracted from the verified JWT — the
    client cannot supply them.  case_id must be within the token's
    allowed_case_ids.
    """
    session = await require_active_session(credentials.credentials, verifier, db)
    claims = session.claims
    actor_id = session.actor_id
    session_id = session.session_id

    allowed_case_ids: list[str] = claims.get("allowed_case_ids") or []
    if body.case_id not in allowed_case_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="case_id not in token's allowed_case_ids.",
        )

    # A11+: enforce per-case role requirement for the requested tool_name.
    # Confirmation grants are pre-authorisations; checking roles here adds
    # defence-in-depth before the MCP gate sees the grant at invocation time.
    required_roles: frozenset[str] = frozenset()
    if body.tool_name in _APPROVAL_TOOLS:
        required_roles = _APPROVAL_ROLES
    elif body.tool_name in _EXPORT_TOOLS:
        required_roles = _EXPORT_ROLES
    elif body.tool_name == "apex.view.raw_read":
        required_roles = _RAW_READ_ROLES
    else:
        required_roles = _HUMAN_MUTATION_ROLES

    if required_roles:
        case_roles_map: dict[str, str] = claims.get("case_roles") or {}
        case_role = case_roles_map.get(body.case_id, "").strip().upper()
        if case_role not in required_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role for this tool in the requested case.",
            )

    grant = ConfirmationGrantRow(
        grant_id=str(uuid.uuid4()),
        actor_id=actor_id,
        session_id=session_id,
        case_id=body.case_id,
        tool_name=body.tool_name,
        request_fingerprint=body.request_fingerprint,
        target_ids=body.target_ids,
        expires_at=datetime.now(UTC) + timedelta(seconds=_GRANT_TTL_SECONDS),
        max_uses=1,
        uses_count=0,
    )
    db.add(grant)
    await db.commit()

    return ConfirmationResponse(grant_id=grant.grant_id)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _matches(row: ConfirmationGrantRow, session: ActiveSession, body: ConfirmationRequest) -> bool:
    return (
        row.actor_id == session.actor_id
        and row.session_id == session.session_id
        and row.case_id == body.case_id
        and row.tool_name == body.tool_name
        and row.request_fingerprint == body.request_fingerprint
        and tuple(row.target_ids) == tuple(body.target_ids)
    )


@router.post(
    "/confirmations/lookup",
    response_model=ConfirmationLookupResponse,
    tags=["confirmations"],
)
async def lookup_confirmation(
    body: ConfirmationRequest,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),  # noqa: B008
    verifier: JwtTokenVerifier = Depends(_get_jwt_verifier),  # noqa: B008
    db: AsyncSession = Depends(_get_db),  # noqa: B008
) -> ConfirmationLookupResponse:
    """Find an unused, unexpired grant for this exact call without consuming it.

    The caller consumes it separately, after its own checks pass, so a call that
    fails before execution does not burn the analyst's approval.
    """
    session = await require_active_session(credentials.credentials, verifier, db)
    now = datetime.now(UTC)
    rows = (
        await db.execute(
            select(ConfirmationGrantRow).where(
                ConfirmationGrantRow.actor_id == session.actor_id,
                ConfirmationGrantRow.session_id == session.session_id,
                ConfirmationGrantRow.case_id == body.case_id,
                ConfirmationGrantRow.tool_name == body.tool_name,
                ConfirmationGrantRow.request_fingerprint == body.request_fingerprint,
                ConfirmationGrantRow.expires_at > now,
            )
        )
    ).scalars().all()
    for row in rows:
        if row.uses_count < row.max_uses and _matches(row, session, body):
            return ConfirmationLookupResponse(grant_id=row.grant_id)
    return ConfirmationLookupResponse(grant_id=None)


@router.post(
    "/confirmations/{grant_id}/consume",
    response_model=ConfirmationConsumeResponse,
    tags=["confirmations"],
)
async def consume_confirmation(
    grant_id: str,
    body: ConfirmationRequest,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),  # noqa: B008
    verifier: JwtTokenVerifier = Depends(_get_jwt_verifier),  # noqa: B008
    db: AsyncSession = Depends(_get_db),  # noqa: B008
) -> ConfirmationConsumeResponse:
    """Use one grant once, only if it still matches the caller and the exact call."""
    session = await require_active_session(credentials.credentials, verifier, db)
    row = await db.get(ConfirmationGrantRow, grant_id)
    if (
        row is None
        or _aware(row.expires_at) <= datetime.now(UTC)
        or row.uses_count >= row.max_uses
        or not _matches(row, session, body)
    ):
        return ConfirmationConsumeResponse(authorized=False)

    # Conditional increment: of two concurrent consumes, only one sees rowcount 1.
    cursor: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        update(ConfirmationGrantRow)
        .where(
            ConfirmationGrantRow.grant_id == grant_id,
            ConfirmationGrantRow.uses_count < ConfirmationGrantRow.max_uses,
        )
        .values(uses_count=ConfirmationGrantRow.uses_count + 1)
    )
    await db.commit()
    return ConfirmationConsumeResponse(authorized=cursor.rowcount > 0)


__all__ = ["router"]

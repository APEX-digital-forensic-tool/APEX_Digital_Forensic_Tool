"""FastAPI router for POST /confirmations — confirmation grant issuance."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from apex_backend.auth.jwt_verifier import JwtTokenVerifier
from apex_backend.auth.schemas import ConfirmationRequest, ConfirmationResponse
from apex_backend.auth.session_guard import require_active_session
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
    claims = await require_active_session(credentials.credentials, verifier, db)
    actor_id = str(claims["sub"])
    session_id = str(claims["session_id"])

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


__all__ = ["router"]

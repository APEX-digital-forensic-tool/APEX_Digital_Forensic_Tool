"""Confirmation grants checked through the APEX backend API instead of its database.

An MCP server on the analyst's machine has no business holding database credentials.
This provider asks the backend about grants with the analyst's own bearer token, the
one that authenticated the current MCP call, so the backend decides which actor and
session a grant belongs to. Anything other than a clear yes from the backend denies.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote, urlparse

import httpx
from mcp.server.auth.middleware.auth_context import get_access_token

from apex_mcp.confirmation import ConfirmationRequest
from apex_mcp.frontend_security import FrontendSession, PersistentFrontendSecurityProvider

_logger = logging.getLogger(__name__)

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
DEFAULT_TIMEOUT_SECONDS = 10.0


def validate_confirmation_api_url(url: str) -> str:
    """Return the base URL without a trailing slash; plain HTTP only for loopback."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if not host or parsed.scheme not in {"http", "https"}:
        raise ValueError("Confirmation API URL must be an absolute HTTP(S) URL.")
    if parsed.scheme == "http" and host not in _LOOPBACK_HOSTS:
        raise ValueError("Confirmation API URL must use HTTPS unless it is loopback.")
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise ValueError("Confirmation API URL must not carry credentials, query or fragment.")
    return url.rstrip("/")


class HttpFrontendSecurityProvider(PersistentFrontendSecurityProvider):
    """Session from JWT claims; grant lookup and consume through the backend API."""

    def __init__(
        self,
        base_url: str,
        *,
        client: httpx.Client | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        super().__init__()
        self._base_url = validate_confirmation_api_url(base_url)
        # ``call_tool`` is synchronous, so the backend is reached synchronously.
        self._client = client or httpx.Client(timeout=timeout, follow_redirects=False)

    def close(self) -> None:
        self._client.close()

    def confirmation_for(
        self,
        session: FrontendSession,
        *,
        case_id: str,
        tool_name: str,
        request_fingerprint: str,
        target_ids: tuple[str, ...],
    ) -> ConfirmationRequest | None:
        body = {
            "case_id": case_id,
            "tool_name": tool_name,
            "request_fingerprint": request_fingerprint,
            "target_ids": list(target_ids),
        }
        data = self._post("/confirmations/lookup", body)
        grant_id = data.get("grant_id") if data is not None else None
        if not isinstance(grant_id, str) or not grant_id:
            return None
        return ConfirmationRequest(
            grant_id=grant_id,
            actor_id=session.actor_id,
            session_id=session.session_id,
            case_id=case_id,
            tool_name=tool_name,
            request_fingerprint=request_fingerprint,
            target_ids=target_ids,
        )

    def authorize(self, request: ConfirmationRequest) -> bool:
        body = {
            "case_id": request.case_id,
            "tool_name": request.tool_name,
            "request_fingerprint": request.request_fingerprint,
            "target_ids": list(request.target_ids),
        }
        data = self._post(f"/confirmations/{quote(request.grant_id, safe='')}/consume", body)
        return data is not None and data.get("authorized") is True

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any] | None:
        access_token = get_access_token()
        if access_token is None or not access_token.token:
            return None
        try:
            response = self._client.post(
                f"{self._base_url}{path}",
                json=body,
                headers={"Authorization": f"Bearer {access_token.token}"},
            )
        except httpx.HTTPError as exc:
            _logger.warning("confirmation API unreachable (%s)", type(exc).__name__)
            return None
        if response.status_code != 200:
            _logger.warning("confirmation API answered HTTP %s", response.status_code)
            return None
        try:
            data = response.json()
        except ValueError:
            return None
        return data if isinstance(data, dict) else None


__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "HttpFrontendSecurityProvider",
    "validate_confirmation_api_url",
]

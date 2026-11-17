"""POST /llm/v1/chat/completions: signed-in clients reach the upstream model through us."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from apex_backend.auth.jwt_verifier import JwtTokenVerifier
from apex_backend.auth.session_guard import require_active_session
from apex_backend.llm.upstream import LlmUpstream

_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/llm/v1", tags=["llm"])
_bearer = HTTPBearer()

MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
_MAX_MESSAGES = 256
_ROLES = frozenset({"system", "user", "assistant", "tool"})
# Everything else the client sends (model, stream, tools, user, n, ...) is dropped:
# the server picks the model and serves one non-streamed answer.
_FORWARDED = ("messages", "temperature", "top_p", "max_tokens", "response_format", "stop")


class LlmGateway:
    """The configured upstream (None when serving is off) and the client that reaches it."""

    def __init__(self, upstream: LlmUpstream | None, client: httpx.AsyncClient) -> None:
        self.upstream = upstream
        self.client = client


def _get_gateway() -> LlmGateway:
    """Dependency: resolved by the app factory via dependency_overrides."""
    raise NotImplementedError("llm gateway dependency not wired.")


def _get_db() -> AsyncSession:
    """Dependency: resolved by the app factory via dependency_overrides."""
    raise NotImplementedError("db dependency not wired.")


def _get_jwt_verifier() -> JwtTokenVerifier:
    """Dependency: resolved by the app factory via dependency_overrides."""
    raise NotImplementedError("jwt_verifier dependency not wired.")


def _fail(code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _outgoing(body: Any, upstream: LlmUpstream) -> dict[str, Any]:
    """Validate the client's request and build the one the upstream receives."""
    if not isinstance(body, dict):
        raise _fail(status.HTTP_400_BAD_REQUEST, "Request body must be a JSON object.")
    if body.get("stream"):
        raise _fail(status.HTTP_400_BAD_REQUEST, "Streaming is not supported.")
    messages = body.get("messages")
    if (
        not isinstance(messages, list)
        or not 1 <= len(messages) <= _MAX_MESSAGES
        or any(
            not isinstance(m, dict)
            or m.get("role") not in _ROLES
            or not isinstance(m.get("content"), str | list)
            for m in messages
        )
    ):
        raise _fail(status.HTTP_400_BAD_REQUEST, "messages must be a list of role/content objects.")
    requested = body.get("max_tokens")
    if requested is None:
        requested = upstream.max_tokens
    if type(requested) is not int or requested < 1:
        raise _fail(status.HTTP_400_BAD_REQUEST, "max_tokens must be a positive integer.")
    outgoing = {key: body[key] for key in _FORWARDED if key in body}
    outgoing["model"] = upstream.model
    outgoing["max_tokens"] = min(requested, upstream.max_tokens)
    return outgoing


async def _read_capped(chunks: AsyncIterator[bytes], limit: int, too_large: HTTPException) -> bytes:
    data = bytearray()
    async for chunk in chunks:
        data += chunk
        if len(data) > limit:
            raise too_large
    return bytes(data)


def _parse_json(raw: bytes) -> Any:
    """Parsed JSON, or None for anything malformed, including pathological nesting."""
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError, RecursionError):
        return None


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),  # noqa: B008
    verifier: JwtTokenVerifier = Depends(_get_jwt_verifier),  # noqa: B008
    db: AsyncSession = Depends(_get_db),  # noqa: B008
    gateway: LlmGateway = Depends(_get_gateway),  # noqa: B008
) -> JSONResponse:
    """OpenAI-compatible chat completion, answered by the server's model.

    The response carries the upstream's ``model`` so clients record the model
    that actually answered.
    """
    session = await require_active_session(credentials.credentials, verifier, db)
    # The model can take minutes; give the connection back to the pool before waiting.
    await db.close()
    sizes = {"request": 0, "response": 0}
    outcome = status.HTTP_500_INTERNAL_SERVER_ERROR
    try:
        payload = await _complete(request, gateway, sizes)
        outcome = status.HTTP_200_OK
        return JSONResponse(payload)
    except HTTPException as exc:
        outcome = exc.status_code
        raise
    finally:
        _logger.info(
            "llm call actor=%s session=%s request_bytes=%d response_bytes=%d status=%d",
            session.actor_id,
            session.session_id,
            sizes["request"],
            sizes["response"],
            outcome,
        )


async def _complete(
    request: Request, gateway: LlmGateway, sizes: dict[str, int]
) -> dict[str, Any]:
    upstream = gateway.upstream
    if upstream is None:
        raise _fail(status.HTTP_503_SERVICE_UNAVAILABLE, "LLM serving is not configured.")

    too_large = _fail(status.HTTP_413_CONTENT_TOO_LARGE, "Request body is too large.")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_REQUEST_BYTES:
        raise too_large
    raw = await _read_capped(request.stream(), MAX_REQUEST_BYTES, too_large)
    sizes["request"] = len(raw)
    body = _parse_json(raw)
    if body is None:
        raise _fail(status.HTTP_400_BAD_REQUEST, "Request body must be JSON.")
    outgoing = _outgoing(body, upstream)

    try:
        async with gateway.client.stream(
            "POST",
            upstream.completions_url,
            json=outgoing,
            headers={"Authorization": f"Bearer {upstream.api_key}"},
            timeout=upstream.timeout,
        ) as response:
            code = response.status_code
            _check_upstream_status(code)
            content = await _read_capped(
                response.aiter_bytes(),
                MAX_RESPONSE_BYTES,
                _fail(status.HTTP_502_BAD_GATEWAY, "The model answer is too large."),
            )
    except httpx.TimeoutException as exc:
        raise _fail(status.HTTP_504_GATEWAY_TIMEOUT, "The model did not answer in time.") from exc
    except httpx.HTTPError as exc:
        _logger.warning("LLM upstream unreachable: %s", type(exc).__name__)
        raise _fail(status.HTTP_502_BAD_GATEWAY, "The model service is unreachable.") from exc

    sizes["response"] = len(content)
    payload = _parse_json(content)
    if not isinstance(payload, dict):
        raise _fail(status.HTTP_502_BAD_GATEWAY, "The model service returned invalid JSON.")
    payload.setdefault("model", upstream.model)
    return payload


def _check_upstream_status(code: int) -> None:
    """Map an upstream failure to what the client should hear. Bodies are never echoed:
    they may quote the request or name the account."""
    if code < 300:
        return
    if code == status.HTTP_429_TOO_MANY_REQUESTS:
        raise _fail(code, "The model service is rate limited. Try again later.")
    if code in (401, 402, 403, 404):
        # Server-side problems (key, balance, model or URL). A 401 here would also
        # read as "your login expired" to the client.
        _logger.error("LLM upstream refused the server's request (HTTP %d).", code)
        raise _fail(status.HTTP_502_BAD_GATEWAY, "The model service refused the server.")
    if 400 <= code < 500:
        _logger.warning("LLM upstream rejected a request (HTTP %d).", code)
        raise _fail(status.HTTP_400_BAD_REQUEST, "The model service rejected the request.")
    _logger.warning("LLM upstream failed (HTTP %d).", code)
    raise _fail(status.HTTP_502_BAD_GATEWAY, "The model service failed.")


__all__ = ["LlmGateway", "router"]

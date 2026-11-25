"""Grant lookup/consume API and the MCP provider that calls it instead of the DB.

The provider talks to the real FastAPI app (``TestClient`` is a sync ``httpx.Client``
over ASGI), so these tests exercise the actual routes, session guard and SQL.
"""

from __future__ import annotations

import socket
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp.server.auth.middleware.auth_context import auth_context_var
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from mcp.server.auth.provider import AccessToken
from sqlalchemy import create_engine, update
from sqlalchemy.orm import sessionmaker

from apex_backend.app import create_app
from apex_backend.auth.jwt_utils import issue_access_token
from apex_backend.auth.jwt_verifier import _jwk_to_pem
from apex_backend.auth.keys import load_private_key, public_key_to_jwk
from apex_backend.auth.router import _get_jwt_verifier
from apex_backend.auth.scopes import scopes_for_roles
from apex_backend.models import ConfirmationGrantRow, User, UserSession
from apex_forensic.config import build_services
from apex_mcp.__main__ import main as mcp_main
from apex_mcp.confirmation import ConfirmationRequest
from apex_mcp.frontend_security import FrontendSession
from apex_mcp.remote_confirmation import (
    HttpFrontendSecurityProvider,
    validate_confirmation_api_url,
)

CASE = "case-001"
TOOL = "apex.view.raw_read"
FINGERPRINT = "fp-1"
TARGETS = ("node-a", "node-b")


@dataclass
class Actor:
    actor_id: str
    session_id: str
    token: str

    @property
    def session(self) -> FrontendSession:
        return FrontendSession(
            actor_id=self.actor_id,
            session_id=self.session_id,
            tenant_id="tenant-1",
            allowed_case_ids=frozenset({CASE}),
            roles=frozenset({"ANALYST"}),
        )


@dataclass
class Backend:
    client: TestClient
    provider: HttpFrontendSecurityProvider
    db: sessionmaker
    alice: Actor
    bob: Actor


@pytest.fixture
def backend(tmp_path: Path) -> Iterator[Backend]:
    db_path = tmp_path / "backend.db"
    app = create_app(f"sqlite+aiosqlite:///{db_path}", llm_upstream=None)
    private_key, kid = load_private_key()
    verifier = app.dependency_overrides[_get_jwt_verifier]()
    verifier._keys = {kid: _jwk_to_pem(public_key_to_jwk(private_key.public_key(), kid))}
    verifier._fetched_at = time.monotonic()

    with TestClient(app, base_url="http://127.0.0.1") as client:
        engine = create_engine(f"sqlite:///{db_path}")
        factory = sessionmaker(engine, expire_on_commit=False)
        actors = []
        with factory() as db:
            for name in ("alice", "bob"):
                actor_id, session_id = f"{name}-id", f"{name}-session"
                db.add(User(
                    id=actor_id,
                    username=name,
                    email=f"{name}@test.local",
                    hashed_password="unused",
                    tenant_id="tenant-1",
                    created_at=datetime.now(UTC),
                    is_active=True,
                ))
                db.add(UserSession(
                    session_id=session_id,
                    actor_id=actor_id,
                    tenant_id="tenant-1",
                    created_at=datetime.now(UTC),
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                ))
                token = issue_access_token(
                    private_key=private_key,
                    kid=kid,
                    actor_id=actor_id,
                    session_id=session_id,
                    tenant_id="tenant-1",
                    allowed_case_ids=[CASE],
                    roles=["ANALYST"],
                    scopes=sorted(scopes_for_roles(frozenset({"ANALYST"}))),
                    case_roles={CASE: "ANALYST"},
                )
                actors.append(Actor(actor_id, session_id, token))
            db.commit()
        provider = HttpFrontendSecurityProvider("http://127.0.0.1", client=client)
        yield Backend(client, provider, factory, *actors)
        engine.dispose()


@contextmanager
def calling_as(actor: Actor | None) -> Iterator[None]:
    """Stand in for the MCP auth middleware, which sets this for each tool call."""
    user = None
    if actor is not None:
        user = AuthenticatedUser(
            AccessToken(token=actor.token, client_id="apex", scopes=["apex:mcp"])
        )
    reset = auth_context_var.set(user)
    try:
        yield
    finally:
        auth_context_var.reset(reset)


def issue(backend: Backend, actor: Actor, *, targets: tuple[str, ...] = TARGETS) -> str:
    response = backend.client.post(
        "/confirmations",
        json={
            "case_id": CASE,
            "tool_name": TOOL,
            "request_fingerprint": FINGERPRINT,
            "target_ids": list(targets),
        },
        headers={"Authorization": f"Bearer {actor.token}"},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["grant_id"])


def lookup(backend: Backend, actor: Actor, **overrides: object) -> ConfirmationRequest | None:
    kwargs: dict = {
        "case_id": CASE,
        "tool_name": TOOL,
        "request_fingerprint": FINGERPRINT,
        "target_ids": TARGETS,
    }
    kwargs.update(overrides)
    with calling_as(actor):
        return backend.provider.confirmation_for(actor.session, **kwargs)


def consume(backend: Backend, actor: Actor | None, request: ConfirmationRequest) -> bool:
    with calling_as(actor):
        return backend.provider.authorize(request)


def test_grant_is_found_then_used_exactly_once(backend: Backend) -> None:
    grant_id = issue(backend, backend.alice)

    found = lookup(backend, backend.alice)
    assert found is not None and found.grant_id == grant_id
    assert lookup(backend, backend.alice) is not None, "lookup must not consume"

    assert consume(backend, backend.alice, found) is True
    assert consume(backend, backend.alice, found) is False
    assert lookup(backend, backend.alice) is None
    with backend.db() as db:
        assert db.get(ConfirmationGrantRow, grant_id).uses_count == 1


def test_another_users_token_cannot_see_or_use_the_grant(backend: Backend) -> None:
    issue(backend, backend.alice)
    alice_request = lookup(backend, backend.alice)
    assert alice_request is not None

    assert lookup(backend, backend.bob) is None
    # Bob's token, Alice's grant id and Alice's identity in the body: still refused,
    # because the backend takes the actor from the token.
    assert consume(backend, backend.bob, alice_request) is False
    assert consume(backend, backend.alice, alice_request) is True


@pytest.mark.parametrize(
    "overrides",
    [
        {"request_fingerprint": "other-fingerprint"},
        {"target_ids": ("node-b", "node-a")},
        {"target_ids": ("node-a",)},
        {"tool_name": "report.approve"},
        {"case_id": "case-other"},
    ],
)
def test_grant_only_matches_the_exact_call(backend: Backend, overrides: dict) -> None:
    grant_id = issue(backend, backend.alice)
    assert lookup(backend, backend.alice, **overrides) is None

    request = ConfirmationRequest(
        grant_id=grant_id,
        actor_id=backend.alice.actor_id,
        session_id=backend.alice.session_id,
        case_id=str(overrides.get("case_id", CASE)),
        tool_name=str(overrides.get("tool_name", TOOL)),
        request_fingerprint=str(overrides.get("request_fingerprint", FINGERPRINT)),
        target_ids=tuple(overrides.get("target_ids", TARGETS)),
    )
    assert consume(backend, backend.alice, request) is False


def test_expired_grant_is_refused(backend: Backend) -> None:
    grant_id = issue(backend, backend.alice)
    request = lookup(backend, backend.alice)
    assert request is not None
    with backend.db() as db:
        db.execute(
            update(ConfirmationGrantRow)
            .where(ConfirmationGrantRow.grant_id == grant_id)
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        db.commit()

    assert lookup(backend, backend.alice) is None
    assert consume(backend, backend.alice, request) is False


def test_logged_out_session_stops_its_grants_at_once(backend: Backend) -> None:
    issue(backend, backend.alice)
    request = lookup(backend, backend.alice)
    assert request is not None

    logout = backend.client.post(
        "/auth/logout", headers={"Authorization": f"Bearer {backend.alice.token}"}
    )
    assert logout.status_code == 200, logout.text

    assert lookup(backend, backend.alice) is None
    assert consume(backend, backend.alice, request) is False


def test_no_authenticated_caller_means_no_grant(backend: Backend) -> None:
    issue(backend, backend.alice)
    request = lookup(backend, backend.alice)
    assert request is not None

    with calling_as(None):
        assert backend.provider.confirmation_for(
            backend.alice.session,
            case_id=CASE,
            tool_name=TOOL,
            request_fingerprint=FINGERPRINT,
            target_ids=TARGETS,
        ) is None
    assert consume(backend, None, request) is False
    assert consume(backend, backend.alice, request) is True


def test_concurrent_consumes_let_exactly_one_through(backend: Backend) -> None:
    issue(backend, backend.alice)
    request = lookup(backend, backend.alice)
    assert request is not None

    results: list[bool] = []
    barrier = threading.Barrier(8)

    def worker() -> None:
        barrier.wait()
        results.append(consume(backend, backend.alice, request))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(results) == [False] * 7 + [True]


def test_unreachable_backend_denies() -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    provider = HttpFrontendSecurityProvider(f"http://127.0.0.1:{port}", timeout=2.0)
    actor = Actor("alice-id", "alice-session", "any-token")
    request = ConfirmationRequest(
        grant_id=str(uuid.uuid4()),
        actor_id=actor.actor_id,
        session_id=actor.session_id,
        case_id=CASE,
        tool_name=TOOL,
        request_fingerprint=FINGERPRINT,
        target_ids=TARGETS,
    )
    try:
        with calling_as(actor):
            assert provider.confirmation_for(
                actor.session,
                case_id=CASE,
                tool_name=TOOL,
                request_fingerprint=FINGERPRINT,
                target_ids=TARGETS,
            ) is None
            assert provider.authorize(request) is False
    finally:
        provider.close()


@pytest.mark.parametrize(
    "url",
    [
        "http://apex.example.com",
        "ftp://apex.example.com",
        "apex.example.com",
        "https://user:pw@apex.example.com",
        "https://apex.example.com/?x=1",
    ],
)
def test_url_must_be_https_unless_loopback(url: str) -> None:
    with pytest.raises(ValueError):
        validate_confirmation_api_url(url)


def test_url_accepts_https_and_loopback_http() -> None:
    assert validate_confirmation_api_url("https://apex.example.com/") == "https://apex.example.com"
    assert validate_confirmation_api_url("http://localhost:8000") == "http://localhost:8000"


@pytest.mark.parametrize(
    "grant_source",
    [
        [],
        ["--http-db-url", "sqlite://", "--http-confirmation-url", "https://apex.example.com"],
    ],
)
def test_jwt_mode_needs_exactly_one_grant_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, grant_source: list[str]
) -> None:
    monkeypatch.delenv("APEX_CONFIRMATION_DB_URL", raising=False)
    monkeypatch.delenv("APEX_CONFIRMATION_API_URL", raising=False)
    schema_dir = Path(__file__).resolve().parents[2] / "schemas" / "v1"
    build_services(tmp_path / "f.db").close()
    with pytest.raises(SystemExit) as exc:
        mcp_main([
            "--database", str(tmp_path / "f.db"),
            "--schema-dir", str(schema_dir),
            "--transport", "http",
            "--http-jwks-uri", "https://apex.example.com/.well-known/jwks.json",
            *grant_source,
        ])
    assert exc.value.code == 2

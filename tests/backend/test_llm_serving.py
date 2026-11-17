"""LLM serving route: signed-in clients reach the upstream model; nothing else does."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from apex_backend.app import create_app
from apex_backend.auth.service import hash_password
from apex_backend.database import Base
from apex_backend.llm.upstream import DEFAULT_BASE_URL, DEFAULT_MODEL, LlmUpstream
from apex_backend.models import User

KIMI_KEY = "sk-kimi-server-only-0123456789"
UPSTREAM = LlmUpstream(
    base_url="https://kimi.test/v1", api_key=KIMI_KEY, model="kimi-k3.1-pro", max_tokens=2048
)
CHAT = {
    "model": "client-chosen-model",
    "temperature": 0,
    "max_tokens": 4096,
    "messages": [{"role": "user", "content": "Summarize."}],
    "tools": [{"type": "function"}],
    "user": "someone",
}


class FakeKimi:
    """Records what the server sent upstream and answers with a canned reply."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.reply: httpx.Response | Exception = httpx.Response(
            200,
            json={
                "id": "cmpl-1",
                "model": "kimi-k3.1-pro",
                "choices": [{"message": {"role": "assistant", "content": "{\"ok\": true}"}}],
                "usage": {"total_tokens": 12},
            },
        )

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


async def _seed_user(url: str) -> None:
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        db.add(
            User(
                id=str(uuid.uuid4()),
                username="analyst",
                email="analyst@example.com",
                hashed_password=hash_password("pw-123456"),
                tenant_id="tenant-1",
                created_at=datetime.now(UTC),
                is_active=True,
            )
        )
        await db.commit()
    await engine.dispose()


async def _client(tmp_path, kimi: FakeKimi, upstream: LlmUpstream | None = UPSTREAM):
    url = f"sqlite+aiosqlite:///{tmp_path / 'backend.db'}"
    await _seed_user(url)
    app = create_app(url, llm_upstream=upstream, llm_transport=httpx.MockTransport(kimi.handler))
    return app


@pytest_asyncio.fixture
async def served(tmp_path):
    kimi = FakeKimi()
    app = await _client(tmp_path, kimi)
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, kimi


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/auth/login",
        json={"email": "analyst@example.com", "password": "pw-123456", "tenant_id": "tenant-1"},
    )
    assert response.status_code == 200
    return str(response.json()["access_token"])


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_signed_in_client_gets_the_upstream_answer(served) -> None:
    client, kimi = served
    token = await _login(client)

    response = await client.post("/llm/v1/chat/completions", json=CHAT, headers=_bearer(token))

    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == "{\"ok\": true}"
    assert response.json()["model"] == "kimi-k3.1-pro"
    [sent] = kimi.requests
    assert str(sent.url) == "https://kimi.test/v1/chat/completions"
    assert sent.headers["authorization"] == f"Bearer {KIMI_KEY}"
    body = json.loads(sent.content)
    assert body == {
        "model": "kimi-k3.1-pro",
        "temperature": 0,
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": "Summarize."}],
    }
    assert token not in sent.content.decode()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer not-a-jwt"}, {"Authorization": "Basic abc"}],
)
async def test_requests_without_a_valid_login_never_reach_upstream(served, headers) -> None:
    client, kimi = served

    response = await client.post("/llm/v1/chat/completions", json=CHAT, headers=headers)

    assert response.status_code == 401
    assert kimi.requests == []


@pytest.mark.asyncio
async def test_logout_cuts_off_the_model(served) -> None:
    client, kimi = served
    token = await _login(client)
    assert (await client.post("/auth/logout", headers=_bearer(token))).status_code == 200

    response = await client.post("/llm/v1/chat/completions", json=CHAT, headers=_bearer(token))

    assert response.status_code == 401
    assert response.json()["detail"] == "Session revoked."
    assert kimi.requests == []


@pytest.mark.asyncio
async def test_serving_without_an_upstream_key_answers_503(tmp_path) -> None:
    kimi = FakeKimi()
    app = await _client(tmp_path, kimi, upstream=None)
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        token = await _login(client)
        response = await client.post(
            "/llm/v1/chat/completions", json=CHAT, headers=_bearer(token)
        )
    assert response.status_code == 503
    assert kimi.requests == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({**CHAT, "stream": True}, 400),
        ({**CHAT, "messages": []}, 400),
        ({**CHAT, "messages": [{"role": "boss", "content": "x"}]}, 400),
        ({**CHAT, "max_tokens": "lots"}, 400),
        ([1, 2], 400),
        ({**CHAT, "messages": [{"role": "user", "content": "x" * (2 * 1024 * 1024)}]}, 413),
    ],
)
async def test_malformed_requests_are_rejected_before_upstream(served, body, code) -> None:
    client, kimi = served
    token = await _login(client)

    response = await client.post("/llm/v1/chat/completions", json=body, headers=_bearer(token))

    assert response.status_code == code
    assert kimi.requests == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("reply", "code"),
    [
        (httpx.Response(401, json={"error": {"message": f"bad key {KIMI_KEY}"}}), 502),
        (httpx.Response(403, text=f"forbidden {KIMI_KEY}"), 502),
        (httpx.Response(429, json={"error": {"message": "slow down"}}), 429),
        (httpx.Response(400, json={"error": {"message": f"echo {KIMI_KEY}"}}), 400),
        (httpx.Response(500, text="boom"), 502),
        (httpx.Response(200, text="not json"), 502),
        (httpx.ReadTimeout("slow"), 504),
        (httpx.ConnectError("down"), 502),
    ],
)
async def test_upstream_failures_map_to_client_codes_without_leaking(served, reply, code) -> None:
    client, kimi = served
    token = await _login(client)
    kimi.reply = reply

    response = await client.post("/llm/v1/chat/completions", json=CHAT, headers=_bearer(token))

    assert response.status_code == code
    assert KIMI_KEY not in response.text
    assert set(response.json()) == {"detail"}


def test_upstream_settings_come_from_env_with_kimi_defaults() -> None:
    assert LlmUpstream.from_env({}) is None
    upstream = LlmUpstream.from_env({"APEX_LLM_UPSTREAM_API_KEY": "k"})
    assert upstream == LlmUpstream(base_url=DEFAULT_BASE_URL, api_key="k", model=DEFAULT_MODEL)
    assert upstream.model == "kimi-k3.1-pro"
    custom = LlmUpstream.from_env(
        {
            "APEX_LLM_UPSTREAM_API_KEY": "k",
            "APEX_LLM_UPSTREAM_BASE_URL": "https://api.moonshot.cn/v1",
            "APEX_LLM_MODEL": "kimi-k3",
            "APEX_LLM_MAX_TOKENS": "1000",
        }
    )
    assert custom is not None
    assert custom.completions_url == "https://api.moonshot.cn/v1/chat/completions"
    assert custom.model == "kimi-k3"
    assert custom.max_tokens == 1000
    with pytest.raises(ValueError):
        LlmUpstream.from_env({"APEX_LLM_UPSTREAM_API_KEY": "k", "APEX_LLM_UPSTREAM_BASE_URL": "x"})


@pytest.mark.asyncio
async def test_no_database_connection_is_held_while_the_model_answers(tmp_path) -> None:
    held: list[int] = []
    url = f"sqlite+aiosqlite:///{tmp_path / 'backend.db'}"
    await _seed_user(url)
    app = None

    async def slow_kimi(request: httpx.Request) -> httpx.Response:
        held.append(app.state.db_engine.pool.checkedout())
        return httpx.Response(200, json={"model": "kimi-k3.1-pro", "choices": []})

    app = create_app(url, llm_upstream=UPSTREAM, llm_transport=httpx.MockTransport(slow_kimi))
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        token = await _login(client)
        response = await client.post(
            "/llm/v1/chat/completions", json=CHAT, headers=_bearer(token)
        )
    assert response.status_code == 200
    assert held == [0]


@pytest.mark.asyncio
async def test_none_upstream_means_off_even_when_the_env_names_a_key(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("APEX_LLM_UPSTREAM_API_KEY", "from-env")
    kimi = FakeKimi()
    app = await _client(tmp_path, kimi, upstream=None)
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        token = await _login(client)
        response = await client.post(
            "/llm/v1/chat/completions", json=CHAT, headers=_bearer(token)
        )
    assert response.status_code == 503
    assert kimi.requests == []


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [402, 404])
async def test_upstream_account_or_route_problems_are_server_faults(served, code, caplog) -> None:
    client, kimi = served
    token = await _login(client)
    kimi.reply = httpx.Response(code, json={"error": {"message": "no"}})

    with caplog.at_level("ERROR", logger="apex_backend.llm.router"):
        response = await client.post(
            "/llm/v1/chat/completions", json=CHAT, headers=_bearer(token)
        )

    assert response.status_code == 502
    assert f"HTTP {code}" in caplog.text


@pytest.mark.asyncio
async def test_each_call_is_logged_with_who_asked_and_the_outcome(served, caplog) -> None:
    client, _kimi = served
    token = await _login(client)
    with caplog.at_level("INFO", logger="apex_backend.llm.router"):
        await client.post("/llm/v1/chat/completions", json=CHAT, headers=_bearer(token))
    [line] = [r.getMessage() for r in caplog.records if r.getMessage().startswith("llm call")]
    assert "actor=" in line and "session=" in line and "status=200" in line
    assert "request_bytes=" in line
    assert token not in caplog.text and KIMI_KEY not in caplog.text


@pytest.mark.asyncio
async def test_a_declared_oversized_body_is_refused_before_reading(served) -> None:
    client, kimi = served
    token = await _login(client)
    response = await client.post(
        "/llm/v1/chat/completions",
        content=b"{}",
        headers={**_bearer(token), "Content-Length": str(3 * 1024 * 1024)},
    )
    assert response.status_code == 413
    assert kimi.requests == []


@pytest.mark.asyncio
async def test_deeply_nested_json_is_a_bad_request(served) -> None:
    client, kimi = served
    token = await _login(client)
    response = await client.post(
        "/llm/v1/chat/completions",
        content=b"[" * 100_000 + b"]" * 100_000,
        headers={**_bearer(token), "Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert kimi.requests == []


@pytest.mark.asyncio
async def test_null_max_tokens_uses_the_server_limit(served) -> None:
    client, kimi = served
    token = await _login(client)
    response = await client.post(
        "/llm/v1/chat/completions", json={**CHAT, "max_tokens": None}, headers=_bearer(token)
    )
    assert response.status_code == 200
    assert json.loads(kimi.requests[0].content)["max_tokens"] == UPSTREAM.max_tokens

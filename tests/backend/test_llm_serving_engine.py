"""The engine's APEX server mode through the real backend LLM route: what ends up recorded."""

import json
import threading
import time

import pytest

from apex_desktop.ai import analyze
from apex_forensic.domain.enums import AnalysisProfileType, DataClassification
from apex_forensic.domain.errors import ApexError

SERVER_SETTINGS = {"connection": "APEX_SERVER", "temperature": 0, "max_output": 512, "timeout": 10}


@pytest.fixture
def selection(services, tmp_path):
    source = tmp_path / "evidence.txt"
    source.write_text("content")
    case = services.cases.create_case(name="Server AI case")
    evidence = services.evidence.register_evidence(case_id=case.case_id, source_path=source)
    services.fs.index_evidence(
        case_id=case.case_id,
        evidence_id=evidence.evidence_id,
        profile_type=AnalysisProfileType.FULL_ANALYSIS,
    )
    services.ai_policies.configure(
        case_id=case.case_id,
        expected_revision=0,
        ai_enabled=True,
        external_allowed=True,
        local_only=False,
        allowed_classifications=(DataClassification.SECRET,),
    )
    node = services.repository.list_fs_nodes_for_evidence(evidence.evidence_id)[0]
    return {
        "case_id": case.case_id,
        "resource_type": "FILE_SYSTEM_NODE",
        "resource_id": node.node_id,
        "actor": "local:test",
    }


@pytest.fixture
def real_gateway(tmp_path):
    """The real apex_backend on loopback in front of a fake Kimi: (base_url, token, kimi)."""
    import asyncio
    import socket
    import uuid
    from datetime import UTC, datetime

    import httpx
    import uvicorn
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from apex_backend.app import create_app as create_backend
    from apex_backend.auth.service import hash_password
    from apex_backend.database import Base
    from apex_backend.llm.upstream import LlmUpstream
    from apex_backend.models import User

    url = f"sqlite+aiosqlite:///{tmp_path / 'backend.db'}"

    async def seed():
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

    asyncio.run(seed())
    kimi = {"model": None, "calls": 0, "delay": 0.0}

    async def answer(request: httpx.Request) -> httpx.Response:
        kimi["calls"] += 1
        await asyncio.sleep(kimi["delay"])
        content = json.dumps(
            {"title": "요약", "summary_text": "답", "key_points": [], "citations": []}
        )
        body: dict = {"choices": [{"message": {"content": content}}]}
        if kimi["model"] is not None:
            body["model"] = kimi["model"]
        return httpx.Response(200, json=body)

    upstream = LlmUpstream(
        base_url="https://kimi.test/v1", api_key="sk-kimi", model="kimi-k3.1-pro", timeout=0.5
    )
    app = create_backend(url, llm_upstream=upstream, llm_transport=httpx.MockTransport(answer))
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    token = httpx.post(
        f"{origin}/auth/login",
        json={"email": "analyst@example.com", "password": "pw-123456", "tenant_id": "tenant-1"},
    ).json()["access_token"]
    yield f"{origin}/llm/v1", token, kimi
    server.should_exit = True
    thread.join(timeout=10)


@pytest.mark.parametrize(
    ("reported", "recorded", "unconfirmed"),
    [(None, "apex-server", True), ("kimi-k3.1-pro-0915", "kimi-k3.1-pro-0915", False)],
)
def test_the_model_recorded_through_the_real_server_is_only_what_upstream_reported(
    services, selection, monkeypatch, real_gateway, reported, recorded, unconfirmed
):
    base_url, token, kimi = real_gateway
    kimi["model"] = reported
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps(SERVER_SETTINGS))
    result = analyze(
        services, **selection, server_connection={"base_url": base_url, "access_token": token}
    )
    stored = result["execution"]["result"]
    assert stored["model_id"] == recorded
    warnings = {w["code"]: w for w in stored["warnings"]}
    assert warnings["AI_APEX_SERVER"]["requested_model"] == "kimi-k3.1-pro"
    assert ("AI_MODEL_UNCONFIRMED" in warnings) is unconfirmed


def test_a_server_deadline_is_a_timeout_and_kimi_is_not_called_again(
    services, selection, monkeypatch, real_gateway
):
    base_url, token, kimi = real_gateway
    kimi["delay"] = 2.0
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps(SERVER_SETTINGS))
    with pytest.raises(ApexError) as raised:
        analyze(
            services, **selection, server_connection={"base_url": base_url, "access_token": token}
        )
    assert kimi["calls"] == 1
    assert raised.value.code == "AI_PROVIDER_TIMEOUT"

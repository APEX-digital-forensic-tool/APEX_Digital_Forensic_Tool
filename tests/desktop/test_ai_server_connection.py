"""AI through the signed-in APEX server: the token arrives per request and is never stored."""

import json
import logging
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from apex_desktop import ai as desktop_ai
from apex_desktop.ai import analyze, runtime
from apex_desktop.app import create_app
from apex_desktop.models import AiAnalyze
from apex_forensic.config import build_services
from apex_forensic.domain.enums import AnalysisProfileType, DataClassification
from apex_forensic.domain.errors import ApexError

TOKEN = "eyJhbGciOiJSUzI1NiJ9.server-access-token.signature"
SERVER_SETTINGS = {"connection": "APEX_SERVER", "temperature": 0, "max_output": 512, "timeout": 10}


@pytest.fixture
def reply():
    """How the stand-in answers: HTTP status, the reported model (None omits it), a delay."""
    return {"status": 200, "model": "kimi-k3.1-pro", "delay": 0.0}


@pytest.fixture
def apex_server(reply):
    """A loopback stand-in for the APEX server's /llm/v1 route."""
    seen: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            auth = self.headers.get("Authorization")
            seen.append({"path": self.path, "auth": auth, "body": body})
            content = json.dumps(
                {
                    "title": "요약",
                    "summary_text": "서버가 답했습니다.",
                    "key_points": [],
                    "citations": [],
                }
            )
            answer: dict = {"choices": [{"message": {"content": content}}]}
            if reply["model"] is not None:
                answer["model"] = reply["model"]
            out = json.dumps(answer).encode()
            time.sleep(reply["delay"])
            self.send_response(reply["status"])
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/llm/v1", seen
    server.shutdown()


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


def test_server_mode_without_sign_in_asks_for_login(services, selection, monkeypatch, apex_server):
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps(SERVER_SETTINGS))
    result = analyze(services, **selection)
    assert result["status"] == "LOGIN_REQUIRED"
    assert apex_server[1] == []
    assert runtime(services)["connection"] == "APEX_SERVER"
    assert runtime(services)["configuration_error"] is None


def test_server_mode_sends_the_access_token_and_records_the_served_model(
    services, selection, monkeypatch, apex_server, tmp_path
):
    base_url, seen = apex_server
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps(SERVER_SETTINGS))
    monkeypatch.delenv("APEX_DESKTOP_AI_STORED_KEY", raising=False)

    result = analyze(
        services,
        **selection,
        server_connection={"base_url": base_url, "access_token": TOKEN},
    )

    assert result["status"] == "COMPLETED", result
    [call] = seen
    assert call["path"] == "/llm/v1/chat/completions"
    assert call["auth"] == f"Bearer {TOKEN}"
    assert call["body"]["max_tokens"] == 512
    execution = result["execution"]
    assert execution["result"]["summary_text"] == "서버가 답했습니다."
    assert execution["result"]["provider_id"] == "apex-server"
    assert execution["result"]["model_id"] == "kimi-k3.1-pro"
    services.close()
    stored = b"".join(p.read_bytes() for p in tmp_path.rglob("*") if p.is_file())
    assert TOKEN.encode() not in stored
    assert TOKEN not in json.dumps(result, default=str)


def test_server_connection_is_validated_and_hidden_from_repr():
    model = AiAnalyze.model_validate(
        {
            "case_id": "c",
            "resource_type": "FILE_SYSTEM_NODE",
            "resource_id": "n",
            "server_connection": {"base_url": "https://apex.example/llm/v1", "access_token": TOKEN},
        }
    )
    assert TOKEN not in repr(model)
    with pytest.raises(ValueError):
        AiAnalyze.model_validate(
            {
                "case_id": "c",
                "resource_type": "FILE_SYSTEM_NODE",
                "resource_id": "n",
                "server_connection": {"base_url": "file:///etc", "access_token": TOKEN},
            }
        )


@pytest.mark.parametrize(
    "settings",
    [
        {"connection": "APEX_SERVER"},
        {**SERVER_SETTINGS, "timeout": 0},
        {**SERVER_SETTINGS, "max_output": 10**9},
    ],
)
def test_invalid_server_settings_are_diagnosed(services, monkeypatch, settings):
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps(settings))
    assert runtime(services)["configuration_error"]["code"] == "AI_CONFIGURATION_INVALID"


def test_a_server_connection_waits_longer_than_the_server(monkeypatch):
    from apex_desktop.ai import ServerAiSettings, desktop_settings

    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps({**SERVER_SETTINGS, "timeout": 30}))
    settings = desktop_settings()
    assert isinstance(settings, ServerAiSettings)
    assert settings.timeout == 100


def _connected(base_url):
    return {"base_url": base_url, "access_token": TOKEN}


@pytest.mark.parametrize(
    ("status", "code"),
    [(401, "AUTHENTICATION_FAILED"), (429, "RATE_LIMITED")],
)
def test_server_refusals_surface_as_provider_errors(
    services, selection, monkeypatch, apex_server, reply, status, code
):
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps(SERVER_SETTINGS))
    reply["status"] = status
    with pytest.raises(ApexError) as raised:
        analyze(services, **selection, server_connection=_connected(apex_server[0]))
    assert raised.value.code == code
    assert TOKEN not in str(raised.value)


def test_a_server_that_does_not_answer_in_time_times_out(
    services, selection, monkeypatch, apex_server, reply
):
    monkeypatch.setattr(desktop_ai, "SERVER_TIMEOUT_FLOOR", 0.3)
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps({**SERVER_SETTINGS, "timeout": 0.3}))
    reply["delay"] = 1.5
    with pytest.raises(ApexError) as raised:
        analyze(services, **selection, server_connection=_connected(apex_server[0]))
    assert raised.value.code == "AI_PROVIDER_TIMEOUT"


@pytest.mark.parametrize(
    ("reported", "recorded"),
    [(None, "apex-server"), ("kimi-k3.1-pro\x1b[31m\n\x00", "kimi-k3.1-pro[31m")],
)
def test_the_recorded_model_is_what_the_server_reported_cleaned(
    services, selection, monkeypatch, apex_server, reply, reported, recorded
):
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps(SERVER_SETTINGS))
    reply["model"] = reported
    result = analyze(services, **selection, server_connection=_connected(apex_server[0]))
    assert result["execution"]["result"]["model_id"] == recorded


def test_the_result_names_the_server_it_went_through(
    services, selection, monkeypatch, apex_server
):
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps(SERVER_SETTINGS))
    result = analyze(services, **selection, server_connection=_connected(apex_server[0]))
    origin = apex_server[0].removesuffix("/llm/v1")
    assert result["server_origin"] == origin
    warnings = result["execution"]["result"]["warnings"]
    assert {"code": "AI_APEX_SERVER", "server_origin": origin} in [
        {k: w.get(k) for k in ("code", "server_origin")} for w in warnings
    ]


@pytest.fixture
def local_api(tmp_path, monkeypatch):
    """The engine's real loopback API on a data dir that holds one case allowed to use AI."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    source = tmp_path / "evidence.txt"
    source.write_text("content")
    services = build_services(data_dir / "apex.db")
    try:
        case = services.cases.create_case(name="API case")
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
    finally:
        services.close()
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", json.dumps(SERVER_SETTINGS))
    key = "b" * 48
    with TestClient(
        create_app(data_dir, key),
        base_url="http://127.0.0.1",
        headers={"Authorization": f"Bearer {key}"},
    ) as client:
        yield client, {
            "case_id": case.case_id,
            "resource_type": "FILE_SYSTEM_NODE",
            "resource_id": node.node_id,
        }


def test_the_ai_analyze_operation_carries_the_connection_to_the_server(local_api, apex_server):
    client, target = local_api
    base_url, seen = apex_server
    response = client.post(
        "/v1/operations/ai.analyze",
        json={**target, "server_connection": _connected(base_url)},
    )
    body = response.json()
    assert body["ok"], body
    assert body["data"]["status"] == "COMPLETED"
    assert [call["auth"] for call in seen] == [f"Bearer {TOKEN}"]
    assert TOKEN not in response.text


@pytest.mark.parametrize(
    "connection",
    [
        {"base_url": "file:///etc", "access_token": TOKEN},
        {"base_url": "https://apex.example/llm/v1", "access_token": TOKEN, "extra": 1},
    ],
)
def test_a_rejected_connection_never_echoes_the_token(local_api, apex_server, caplog, connection):
    client, target = local_api
    with caplog.at_level(logging.DEBUG):
        response = client.post(
            "/v1/operations/ai.analyze", json={**target, "server_connection": connection}
        )
    assert response.status_code == 422
    assert response.json() == {"ok": False, "error": {"code": "VALIDATION_ERROR"}}
    assert TOKEN not in response.text
    assert TOKEN not in caplog.text
    assert apex_server[1] == []



@pytest.mark.parametrize(
    "settings",
    [
        {**SERVER_SETTINGS, "max_output": 1e400},
        {**SERVER_SETTINGS, "timeout": 1e400},
        {
            "provider_id": "custom",
            "base_url": "https://api.example.com/v1",
            "model_id": "m",
            "api_key_env": "KEY",
            "max_output": 1e400,
        },
    ],
)
def test_overflowing_numbers_in_the_settings_are_diagnosed(services, monkeypatch, settings):
    raw = json.dumps(settings).replace("Infinity", "1e400")
    monkeypatch.setenv("APEX_DESKTOP_AI_CONFIG", raw)
    assert runtime(services)["configuration_error"]["code"] == "AI_CONFIGURATION_INVALID"


def test_a_gateway_timeout_from_a_direct_endpoint_is_a_timeout_asked_once(
    services, selection, monkeypatch, apex_server, reply
):
    url, seen = apex_server
    monkeypatch.setenv("DIRECT_KEY", "direct-key")
    monkeypatch.setenv(
        "APEX_DESKTOP_AI_CONFIG",
        json.dumps(
            {
                "provider_id": "direct",
                "base_url": url,
                "model_id": "m",
                "api_key_env": "DIRECT_KEY",
                "timeout": 10,
            }
        ),
    )
    reply["status"] = 504
    with pytest.raises(ApexError) as raised:
        analyze(services, **selection)
    assert raised.value.code == "AI_PROVIDER_TIMEOUT"
    assert len(seen) == 1

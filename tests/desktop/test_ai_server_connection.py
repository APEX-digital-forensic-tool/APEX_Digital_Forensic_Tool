"""AI through the signed-in APEX server: the token arrives per request and is never stored."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from apex_desktop.ai import analyze, runtime
from apex_desktop.models import AiAnalyze
from apex_forensic.domain.enums import AnalysisProfileType, DataClassification

TOKEN = "eyJhbGciOiJSUzI1NiJ9.server-access-token.signature"
SERVER_SETTINGS = {"connection": "APEX_SERVER", "temperature": 0, "max_output": 512, "timeout": 10}


@pytest.fixture
def apex_server():
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
            out = json.dumps(
                {"model": "kimi-k3", "choices": [{"message": {"content": content}}]}
            ).encode()
            self.send_response(200)
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
    assert execution["result"]["model_id"] == "kimi-k3"
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

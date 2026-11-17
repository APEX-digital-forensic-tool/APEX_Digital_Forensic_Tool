"""External tools read untrusted evidence, so they must not inherit secrets from the engine."""

import ast
import sys
from pathlib import Path

from apex_forensic.adapters.artifacts.media import _run_bounded_process

SRC = Path(__file__).resolve().parents[2] / "src"
SPAWNERS = {"run", "Popen", "call", "check_call", "check_output"}


def test_a_tool_does_not_see_the_ai_key(monkeypatch):
    monkeypatch.setenv("APEX_DESKTOP_AI_STORED_KEY", "sk-stored-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-managed-secret")
    monkeypatch.setenv("TESSDATA_PREFIX", "/opt/tessdata")
    script = "import os, json; print(json.dumps(dict(os.environ)))"
    result = _run_bounded_process([sys.executable, "-c", script], timeout=30, max_bytes=1 << 20)
    assert result.returncode == 0, result.stderr
    seen = result.stdout.decode()
    assert "sk-stored-secret" not in seen
    assert "sk-managed-secret" not in seen
    assert "/opt/tessdata" in seen


def test_every_subprocess_call_passes_an_explicit_environment():
    missing = []
    for path in sorted(SRC.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in SPAWNERS
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "subprocess"
                and not any(keyword.arg == "env" for keyword in node.keywords)
            ):
                missing.append(f"{path.relative_to(SRC)}:{node.lineno}")
    assert missing == []

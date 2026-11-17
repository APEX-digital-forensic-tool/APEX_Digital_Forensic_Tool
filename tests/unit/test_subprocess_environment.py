"""Evidence decoder subprocesses must not receive application credentials."""

import json
import os
import subprocess
import sys

from apex_forensic.runtime.subprocess_env import subprocess_environment


def test_real_child_has_tool_environment_but_no_provider_or_application_secrets(monkeypatch):
    for key in ["APEX_DESKTOP_AI_STORED_KEY", "APEX_DESKTOP_TOKEN", "OPENAI_API_KEY", "CUSTOM_KEY"]:
        monkeypatch.setenv(key, "synthetic-canary-never-a-real-key")
    monkeypatch.setenv("TESSDATA_PREFIX", "/synthetic/tessdata")
    result = subprocess.run(
        [sys.executable, "-c", "import json,os;print(json.dumps(dict(os.environ)))"],
        env=subprocess_environment(),
        capture_output=True,
        text=True,
        check=True,
    )
    env = json.loads(result.stdout)
    assert env["TESSDATA_PREFIX"] == "/synthetic/tessdata"
    assert env.get("PATH") == os.environ.get("PATH")
    assert "synthetic-canary-never-a-real-key" not in env.values()

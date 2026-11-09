"""Fail-closed signature checks; actual Apple validation runs on native CI."""

import importlib.util
import subprocess
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "macos_release", Path(__file__).resolve().parents[2] / "tools/verify_macos_release.py"
)
assert spec is not None and spec.loader is not None
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

VALID = (
    "Authority=Developer ID Application: APEX (TESTTEAM12)\n"
    "TeamIdentifier=TESTTEAM12\n"
    "Timestamp=Nov 9, 2026 at 10:00:00 AM\n"
    "CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+7 location=embedded\n"
)


def test_valid_developer_id_signature() -> None:
    release.assert_signature(VALID, "TESTTEAM12", executable=True)


@pytest.mark.parametrize(
    "invalid",
    [
        VALID.replace("Developer ID Application:", "Apple Development:"),
        VALID.replace("TeamIdentifier=TESTTEAM12", "TeamIdentifier=OTHERTEAM1"),
        VALID.replace("Timestamp=Nov 9, 2026 at 10:00:00 AM\n", ""),
        VALID.replace("flags=0x10000(runtime)", "flags=0x0(none)"),
        "Signature=adhoc\nTeamIdentifier=not set\n",
        "",
    ],
)
def test_invalid_signature_is_never_publishable(invalid: str) -> None:
    with pytest.raises(RuntimeError):
        release.assert_signature(invalid, "TESTTEAM12", executable=True)


def test_notary_json_is_not_corrupted_by_stderr_warning(monkeypatch) -> None:
    monkeypatch.setattr(
        release.subprocess,
        "run",
        lambda *a, **kw: subprocess.CompletedProcess(a, 0, '{"status":"Accepted"}', "warning"),
    )
    assert release.run("xcrun", "notarytool") == '{"status":"Accepted"}'
    assert release.run("codesign", include_stderr=True).endswith("warning")


def test_failed_native_command_aborts(monkeypatch) -> None:
    monkeypatch.setattr(
        release.subprocess,
        "run",
        lambda *a, **kw: subprocess.CompletedProcess(a, 1, "", "verification failed"),
    )
    with pytest.raises(RuntimeError, match="verification failed"):
        release.run("codesign", "--verify")


def test_timeout_is_not_accepted(monkeypatch) -> None:
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("notarytool", 30)

    monkeypatch.setattr(release.subprocess, "run", timeout)
    with pytest.raises(subprocess.TimeoutExpired):
        release.run("xcrun", "notarytool", timeout=30)

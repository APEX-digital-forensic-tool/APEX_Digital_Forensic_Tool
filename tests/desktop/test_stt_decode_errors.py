"""A queued speech job whose bytes are not decodable audio ends with a media code (#105)."""

import sys
from pathlib import Path
from time import monotonic, sleep
from types import SimpleNamespace

import pytest
from test_followup_index_tools import nodes_of, stt
from test_local_api import call
from test_local_api import client as api_client

from apex_desktop import machine
from apex_forensic.adapters.machine_extraction import stt as stt_adapter
from apex_forensic.adapters.machine_extraction.stt import (
    FasterWhisperSttProvider,
    WhisperCppCliSttProvider,
)
from apex_forensic.domain.errors import ApexError

client = api_client


def finished(client, cid, task_id):
    deadline = monotonic() + 15
    while monotonic() < deadline:
        record = next(r for r in call(client, "tasks.list", case_id=cid) if r["task_id"] == task_id)
        if record["status"] not in {"QUEUED", "RUNNING", "CANCELLING"}:
            return record
        sleep(0.02)
    pytest.fail("Task did not finish")


def _faster_whisper(transcribed: list[object]) -> FasterWhisperSttProvider:
    """The real PyAV decoder in front of a stand-in model."""

    def transcribe(audio, **kwargs):
        transcribed.append(audio)
        return iter([]), SimpleNamespace(language="en")

    provider = FasterWhisperSttProvider(model_path=Path("model"))
    provider._engine = SimpleNamespace(
        model=SimpleNamespace(is_multilingual=True), transcribe=transcribe
    )
    return provider


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"just text, not audio", "MEDIA_DECODE_FAILED"),
        (b"", "MEDIA_DECODE_FAILED"),
        (None, "MEDIA_AUDIO_FORMAT_UNSUPPORTED"),
    ],
)
def test_faster_whisper_reports_undecodable_bytes_with_a_media_code(
    tmp_path, valid_png, content, code
):
    source = tmp_path / "source"
    # A PNG opens as a container that has no audio stream.
    source.write_bytes(valid_png if content is None else content)
    transcribed: list[object] = []
    with pytest.raises(ApexError) as error:
        _faster_whisper(transcribed)._transcribe(source, None)
    assert error.value.code == code
    assert transcribed == []


def test_faster_whisper_still_transcribes_real_audio(tmp_path, valid_wav):
    source = tmp_path / "source"
    source.write_bytes(valid_wav)
    transcribed: list[object] = []
    assert _faster_whisper(transcribed)._transcribe(source, None) == []
    assert len(transcribed) == 1


# whisper.cpp prints this and moves on when it cannot read the input (examples/cli).
@pytest.mark.skipif(sys.platform == "win32", reason="uses a POSIX shell script as whisper-cli")
@pytest.mark.parametrize("exit_code", [0, 2])
def test_whisper_cpp_reports_unreadable_audio_with_a_media_code(tmp_path, exit_code):
    cli = tmp_path / "whisper-cli"
    cli.write_text(
        f"#!/bin/sh\necho \"error: failed to read audio file '$4'\" >&2\nexit {exit_code}\n",
        encoding="utf-8",
    )
    cli.chmod(0o755)
    model = tmp_path / "model.bin"
    model.write_bytes(b"model")
    source = tmp_path / "source"
    source.write_bytes(b"just text, not audio")
    provider = WhisperCppCliSttProvider(executable=str(cli), model_path=model, timeout=5)
    with pytest.raises(ApexError) as error:
        provider.analyze_audio(source)
    assert error.value.code == "MEDIA_DECODE_FAILED"


def test_queued_speech_job_on_text_bytes_fails_with_a_media_code(client, tmp_path, monkeypatch):
    import apex_desktop.tool_targets as targets

    root = tmp_path / "queued"
    root.mkdir()
    (root / "fake.wav").write_text("just text, not audio", encoding="utf-8")
    cid, nodes = nodes_of(client, root, "Queued junk")
    monkeypatch.setattr(targets, "media_executable", lambda _name: None)
    monkeypatch.setattr(stt_adapter, "local_model_available", lambda _path: True)
    provider = _faster_whisper([])
    monkeypatch.setattr(machine, "providers", lambda _root: (None, provider))

    body = stt(client, cid, nodes["fake.wav"])
    assert body["ok"] is True, body
    task = finished(client, cid, body["data"]["task_id"])
    assert task["status"] == "FAILED"
    assert task["error"]["code"] == "MEDIA_DECODE_FAILED"

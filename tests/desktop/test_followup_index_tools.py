"""Behaviors from the #62/#65 work that main still lacked after #74."""

import subprocess
import wave
from io import BytesIO
from pathlib import Path

import pytest
from test_local_api import call, wait
from test_local_api import client as api_client

from apex_forensic.runtime.assets import media_executable

client = api_client


def register(client, cid, root, files=True):
    eid = wait(client, cid, call(client, "evidence.register", case_id=cid, source_path=str(root)))[
        "result"
    ]["id"]
    if files:
        wait(
            client,
            cid,
            call(
                client,
                "analysis.start",
                case_id=cid,
                evidence_id=eid,
                kind="FILES",
                profile_type="FULL_ANALYSIS",
            ),
        )
    return eid


def build(client, cid, eid, kind):
    wait(
        client,
        cid,
        call(
            client,
            "analysis.start",
            case_id=cid,
            evidence_id=eid,
            kind=kind,
            profile_type="FULL_ANALYSIS",
        ),
    )


def test_index_built_without_a_file_index_is_not_reported_as_current(client, tmp_path):
    root = tmp_path / "one"
    root.mkdir()
    (root / "a.txt").write_text("a", encoding="utf-8")
    cid = call(client, "cases.create", name="No input")["id"]
    eid = register(client, cid, root, files=False)
    build(client, cid, eid, "TIMELINE")
    build(client, cid, eid, "SEARCH")

    timeline = call(client, "timeline.list", case_id=cid)["index_state"][0]
    search = call(client, "search.query", case_id=cid, query_text="a")["index_state"][0]
    assert timeline["timeline"]["state"] == "NONE"
    assert search["search"]["state"] == "NONE"
    assert timeline["timeline"]["source_items"] == 0


def wav() -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b"\x00\x00" * 800)
    return buffer.getvalue()


needs_ffmpeg = pytest.mark.skipif(
    media_executable("ffprobe") is None or media_executable("ffmpeg") is None,
    reason="ffmpeg and ffprobe decide speech sources by content",
)


def encoded(path: Path, container: str) -> bytes:
    """A real one-second tone in `container`, made by the local ffmpeg."""
    ffmpeg = media_executable("ffmpeg")
    assert ffmpeg is not None
    subprocess.run(
        [
            ffmpeg,
            *("-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac"),
            *("-f", container, str(path)),
        ],
        check=True,
        timeout=60,
    )
    return path.read_bytes()


def nodes_of(client, root, name):
    cid = call(client, "cases.create", name=name)["id"]
    eid = register(client, cid, root)
    items = call(client, "files.list", case_id=cid, evidence_id=eid, all_nodes=True)["items"]
    return cid, {n["original_name"]: n for n in items}


def stt(client, cid, node):
    return client.post(
        "/v1/operations/machine.run",
        json={"case_id": cid, "node_id": node["id"], "kind": "STT"},
    ).json()


@needs_ffmpeg
def test_audio_with_a_misleading_name_reaches_speech_recognition(client, tmp_path):
    root = tmp_path / "audio"
    root.mkdir()
    (root / "voice.dat").write_bytes(encoded(tmp_path / "voice.m4a", "ipod"))
    (root / "memo.3ga").write_bytes(encoded(tmp_path / "memo.3gp", "3gp"))
    (root / "tape").write_bytes(wav())
    cid, nodes = nodes_of(client, root, "Audio names")
    for name in ("voice.dat", "memo.3ga", "tape"):
        body = stt(client, cid, nodes[name])
        assert body["ok"] is True, (name, body)


UTF16_REG = "\ufeffWindows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software]\r\n"


@needs_ffmpeg
def test_text_and_random_binary_are_still_rejected_for_speech(client, tmp_path):
    root = tmp_path / "other"
    root.mkdir()
    (root / "note.dat").write_text("just text", encoding="utf-8")
    (root / "blob.dat").write_bytes(b"\xff\xe0\x00\x00" + b"\x00" * 40)
    (root / "export.reg").write_bytes(UTF16_REG.encode("utf-16-le"))
    (root / "utf16.dat").write_bytes("\ufeffhello world".encode("utf-16-le"))
    cid, nodes = nodes_of(client, root, "Not audio")
    for name in ("note.dat", "blob.dat", "export.reg", "utf16.dat"):
        body = stt(client, cid, nodes[name])
        assert body["ok"] is False, name
        assert body["error"]["code"] == "MEDIA_AUDIO_FORMAT_UNSUPPORTED", name


# An image or text name is refused before any probe, so this holds without ffprobe too.
def test_image_and_text_names_are_refused_without_probing(client, tmp_path, monkeypatch):
    import apex_desktop.tool_targets as targets

    root = tmp_path / "named"
    root.mkdir()
    (root / "note.txt").write_bytes("\ufeffhello".encode("utf-16-le"))
    (root / "IMG.heic").write_bytes(b"\x00\x00\x00\x18ftypheic" + b"\x00" * 32)
    cid, nodes = nodes_of(client, root, "Named")
    monkeypatch.setattr(targets, "media_executable", lambda _name: pytest.fail("probed"))
    for name in ("note.txt", "IMG.heic"):
        body = stt(client, cid, nodes[name])
        assert body["error"]["code"] == "MEDIA_AUDIO_FORMAT_UNSUPPORTED", name


def test_without_ffprobe_an_unclear_file_is_queued_for_the_decoder(
    client, tmp_path, monkeypatch
):
    import apex_desktop.tool_targets as targets

    root = tmp_path / "noprobe"
    root.mkdir()
    (root / "voice.dat").write_bytes(b"maybe audio")
    cid, nodes = nodes_of(client, root, "No ffprobe")
    monkeypatch.setattr(targets, "media_executable", lambda _name: None)
    assert stt(client, cid, nodes["voice.dat"])["ok"] is True


def test_unreadable_file_keeps_the_audio_format_refusal(client, tmp_path):
    root = tmp_path / "gone"
    root.mkdir()
    (root / "x.dat").write_text("not audio", encoding="utf-8")
    cid = call(client, "cases.create", name="Unreadable")["id"]
    eid = register(client, cid, root)
    nodes = {
        n["original_name"]: n
        for n in call(client, "files.list", case_id=cid, evidence_id=eid, all_nodes=True)["items"]
    }
    # The indexed file is gone, so its bytes cannot be read to judge it.
    (root / "x.dat").unlink()
    response = client.post(
        "/v1/operations/machine.run",
        json={"case_id": cid, "node_id": nodes["x.dat"]["id"], "kind": "STT"},
    )
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "MEDIA_AUDIO_FORMAT_UNSUPPORTED"

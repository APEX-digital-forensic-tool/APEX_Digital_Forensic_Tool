"""Behaviors from the #62/#65 work that main still lacked after #74."""

import os
import subprocess
import sys
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


# (name, ffmpeg muxer, encoder, extra muxer flags). mp3 is written without an ID3 tag,
# the hardest case for a probe; every one must be judged as audio by its bytes.
CONTAINERS = [
    ("song.mp3", "mp3", "libmp3lame", ("-write_id3v2", "0")),
    ("raw.aac", "adts", "aac", ()),
    ("tone.flac", "flac", "flac", ()),
    ("tone.ogg", "ogg", "libopus", ()),
    ("tone.opus", "opus", "libopus", ()),
    ("tone.aiff", "aiff", "pcm_s16be", ()),
    ("tone.caf", "caf", "pcm_s16be", ()),
    ("tone.mkv", "matroska", "aac", ()),
    ("tone.webm", "webm", "libopus", ()),
    ("tone.avi", "avi", "libmp3lame", ()),
    ("tone.wma", "asf", "wmav2", ()),
    ("tone.au", "au", "pcm_s16be", ()),
    ("tone.amr", "amr", "libopencore_amrnb", ("-ar", "8000", "-ac", "1")),
]


@needs_ffmpeg
def test_common_audio_containers_are_accepted_by_content(client, tmp_path):
    ffmpeg = media_executable("ffmpeg")
    assert ffmpeg is not None
    encoders = subprocess.run(
        [ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, check=True
    ).stdout
    root = tmp_path / "containers"
    root.mkdir()
    made = []
    for name, muxer, encoder, flags in CONTAINERS:
        if f" {encoder} " not in encoders:
            continue
        subprocess.run(
            [
                ffmpeg,
                *("-v", "error", "-f", "lavfi", "-i", "sine=duration=1"),
                *("-c:a", encoder, *flags, "-f", muxer, str(root / name)),
            ],
            check=True,
            timeout=60,
        )
        made.append(name)
    assert len(made) >= 8, made
    cid, nodes = nodes_of(client, root, "Containers")
    refused = {name: stt(client, cid, nodes[name]) for name in made}
    assert all(body["ok"] for body in refused.values()), {
        name: body["error"]["code"] for name, body in refused.items() if not body["ok"]
    }


def silent_video(path: Path) -> bytes:
    ffmpeg = media_executable("ffmpeg")
    assert ffmpeg is not None
    subprocess.run(
        [
            ffmpeg,
            *("-v", "error", "-f", "lavfi", "-i", "color=size=16x16:duration=1"),
            *("-c:v", "mpeg4", "-f", "mp4", str(path)),
        ],
        check=True,
        timeout=60,
    )
    return path.read_bytes()


# Refused only on positive evidence: ffprobe opened the container and found no audio,
# or it could not open the bytes and the name also says text or image.
@needs_ffmpeg
def test_speech_is_refused_only_on_positive_evidence(client, tmp_path):
    root = tmp_path / "evidence"
    root.mkdir()
    (root / "clip.mp4").write_bytes(silent_video(tmp_path / "silent.mp4"))
    (root / "voice.dat").write_bytes(silent_video(tmp_path / "silent2.mp4"))
    (root / "note.txt").write_text("just text", encoding="utf-8")
    (root / "photo.png").write_bytes(b"\x00" * 64)
    (root / "recording.txt").write_bytes(wav())
    (root / "note.dat").write_text("just text", encoding="utf-8")
    (root / "blob.dat").write_bytes(b"\xff\xe0\x00\x00" + b"\x00" * 40)
    (root / "utf16.dat").write_bytes("\ufeffhello world".encode("utf-16-le"))
    (root / "fake.wav").write_text("just text", encoding="utf-8")
    cid, nodes = nodes_of(client, root, "Evidence")
    for name in ("clip.mp4", "voice.dat", "note.txt", "photo.png"):
        body = stt(client, cid, nodes[name])
        assert body["ok"] is False, name
        assert body["error"]["code"] == "MEDIA_AUDIO_FORMAT_UNSUPPORTED", name
    # Real audio whatever the name, and bytes nothing could open under a neutral or
    # audio name: queued, so the job reports what the decoder finds.
    for name in ("recording.txt", "note.dat", "blob.dat", "utf16.dat", "fake.wav"):
        assert stt(client, cid, nodes[name])["ok"] is True, name


# A size limit says nothing about the content, so the name cannot refuse it either.
@needs_ffmpeg
def test_audio_too_large_to_probe_is_queued_whatever_the_name(client, tmp_path, monkeypatch):
    import apex_desktop.tool_targets as targets

    root = tmp_path / "large"
    root.mkdir()
    (root / "note.txt").write_bytes(wav())
    cid, nodes = nodes_of(client, root, "Large")
    monkeypatch.setattr(targets, "_PROBE_MAX_BYTES", 16)
    assert stt(client, cid, nodes["note.txt"])["ok"] is True


# Without ffprobe nothing was learned about the bytes, so nothing is refused by name.
def test_without_ffprobe_every_file_is_queued(client, tmp_path, monkeypatch):
    import apex_desktop.tool_targets as targets

    root = tmp_path / "named"
    root.mkdir()
    (root / "note.txt").write_text("just text", encoding="utf-8")
    (root / "photo.png").write_bytes(b"\x00" * 64)
    (root / "call.wav").write_bytes(wav())
    cid, nodes = nodes_of(client, root, "Named")
    monkeypatch.setattr(targets, "media_executable", lambda _name: None)
    for name in ("note.txt", "photo.png", "call.wav"):
        assert stt(client, cid, nodes[name])["ok"] is True, name


# Older ffprobe builds detect an HLS playlist by its content alone. Recreate that by
# giving the probed copy an .m3u8 name, then check the probe never reaches outside it.
@needs_ffmpeg
@pytest.mark.skipif(sys.platform == "win32", reason="uses a POSIX script around ffprobe")
def test_speech_probe_never_follows_a_playlist_outside_the_evidence(client, tmp_path, monkeypatch):
    import apex_desktop.tool_targets as targets

    ffmpeg, ffprobe = media_executable("ffmpeg"), media_executable("ffprobe")
    outside = tmp_path / "outside"
    outside.mkdir()
    segment = outside / "segment.ts"
    subprocess.run(
        [
            *(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "sine=duration=1"),
            *("-c:a", "aac", "-f", "mpegts", str(segment)),
        ],
        check=True,
        timeout=60,
    )
    root = tmp_path / "evidence"
    root.mkdir()
    (root / "playlist.txt").write_text(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n"
        f"#EXTINF:1.0,\n{segment}\n#EXT-X-ENDLIST\n",
        encoding="utf-8",
    )
    wrapper = tmp_path / "ffprobe"
    wrapper.write_text(
        f"#!{sys.executable}\n"
        "import os, shutil, sys\n"
        "args = sys.argv[1:]\n"
        "prefix = 'file:' if args and args[-1].startswith('file:') else ''\n"
        "path = args[-1][len(prefix):] if args else ''\n"
        "if os.path.isfile(path):\n"
        "    shutil.copy(path, path + '.m3u8')\n"
        "    args[-1] = prefix + path + '.m3u8'\n"
        f"os.execv({ffprobe!r}, [{ffprobe!r}, *args])\n",
        encoding="utf-8",
    )
    wrapper.chmod(0o755)
    cid, nodes = nodes_of(client, root, "Playlist")
    monkeypatch.setattr(targets, "media_executable", lambda _name: str(wrapper))

    body = stt(client, cid, nodes["playlist.txt"])
    # Following the playlist would find the outside segment's audio and queue the job.
    assert body["ok"] is False, body
    assert body["error"]["code"] == "MEDIA_AUDIO_FORMAT_UNSUPPORTED"


# A broken ffprobe (missing library, exit 127) says nothing about the file.
@pytest.mark.skipif(sys.platform == "win32", reason="uses a POSIX shell script as ffprobe")
def test_a_broken_ffprobe_leaves_the_decision_to_the_job(client, tmp_path, monkeypatch):
    import apex_desktop.tool_targets as targets

    broken = tmp_path / "ffprobe"
    broken.write_text("#!/bin/sh\nexit 127\n", encoding="utf-8")
    broken.chmod(0o755)
    root = tmp_path / "probe"
    root.mkdir()
    (root / "tape").write_bytes(wav())
    cid, nodes = nodes_of(client, root, "Broken ffprobe")
    monkeypatch.setattr(targets, "media_executable", lambda _name: str(broken))
    body = stt(client, cid, nodes["tape"])
    assert body["ok"] is True, body


# A read failure is an integrity signal; it must not be reported as "not audio".
def test_extensionless_file_changed_after_indexing_reports_the_change(client, tmp_path):
    root = tmp_path / "changed"
    root.mkdir()
    (root / "tape").write_bytes(wav())
    cid, nodes = nodes_of(client, root, "Changed")
    (root / "tape").write_bytes(wav() + b"\x00" * 4096)
    body = stt(client, cid, nodes["tape"])
    assert body["ok"] is False
    assert body["error"]["code"] == "RAW_SOURCE_CHANGED"


@pytest.mark.skipif(
    sys.platform == "win32" or (hasattr(os, "geteuid") and os.geteuid() == 0),
    reason="chmod(0) does not block reading for root or on Windows",
)
def test_unreadable_node_reports_its_own_read_error(client, tmp_path):
    root = tmp_path / "locked"
    root.mkdir()
    (root / "voice.dat").write_bytes(wav())
    os.chmod(root / "voice.dat", 0)
    try:
        cid, nodes = nodes_of(client, root, "Unreadable")
        body = stt(client, cid, nodes["voice.dat"])
    finally:
        os.chmod(root / "voice.dat", 0o600)
    assert body["ok"] is False
    assert body["error"]["code"] == "RAW_LOCATOR_UNSUPPORTED"


# The bytes are gone, so the pre-check cannot judge them; the job reports the real failure.
def test_deleted_file_is_queued_for_the_job_to_report(client, tmp_path):
    root = tmp_path / "gone"
    root.mkdir()
    (root / "x.dat").write_text("not audio", encoding="utf-8")
    cid, nodes = nodes_of(client, root, "Deleted")
    (root / "x.dat").unlink()
    assert stt(client, cid, nodes["x.dat"])["ok"] is True

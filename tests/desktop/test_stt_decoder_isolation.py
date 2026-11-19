"""A speech job decodes the evidence copy and nothing that copy names (#108)."""

import os
import sys
import threading
from contextlib import contextmanager, suppress
from pathlib import Path

import av
import numpy
import pytest
from test_followup_index_tools import nodes_of, stt
from test_local_api import client as api_client
from test_stt_decode_errors import _faster_whisper, finished

import apex_desktop.tool_targets as targets
from apex_desktop import machine
from apex_forensic.adapters.filesystem.content import EvidenceFileContent
from apex_forensic.adapters.machine_extraction import stt as stt_adapter
from apex_forensic.adapters.machine_extraction.stt import WhisperCppCliSttProvider

client = api_client

posix_only = pytest.mark.skipif(
    sys.platform == "win32", reason="uses a FIFO or a POSIX script as whisper-cli"
)
ENGINES = ["faster-whisper", pytest.param("whisper.cpp", marks=posix_only)]


def tone(path: Path, container: str, codec: str) -> bytes:
    """One second of 440 Hz, encoded by PyAV."""
    rate = 16_000
    wave = numpy.sin(2 * numpy.pi * 440 * numpy.arange(rate) / rate) * 8000
    frame = av.AudioFrame.from_ndarray(
        wave.astype(numpy.int16).reshape(1, -1), format="s16", layout="mono"
    )
    frame.sample_rate = rate
    with av.open(str(path), "w", format=container) as output:
        stream = output.add_stream(codec, rate=rate, layout="mono")
        for packet in [*stream.encode(frame), *stream.encode(None)]:
            output.mux(packet)
    return path.read_bytes()


class Sentinel:
    """A FIFO outside the evidence that records whether anything opens it to read."""

    def __init__(self, path: Path, content: bytes) -> None:
        os.mkfifo(path)
        self.opened = False
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._serve, args=(path, content), daemon=True)
        self._thread.start()

    def _serve(self, path: Path, content: bytes) -> None:
        while not self._stop.is_set():
            try:
                # Fails with ENXIO until a reader holds the FIFO open.
                descriptor = os.open(path, os.O_WRONLY | os.O_NONBLOCK)
            except OSError:
                self._stop.wait(0.005)
                continue
            self.opened = True
            os.set_blocking(descriptor, True)
            with suppress(BrokenPipeError), os.fdopen(descriptor, "wb") as stream:
                stream.write(content)

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=5)


def whisper_cli_with_ffmpeg(tmp_path: Path) -> WhisperCppCliSttProvider:
    """A whisper-cli that opens its input with FFmpeg defaults, as FFmpeg-enabled builds do."""
    cli = tmp_path / "whisper-cli"
    cli.write_text(
        f"#!{sys.executable}\n"
        "import json, sys, av\n"
        "args = sys.argv[1:]\n"
        "source, stem = args[args.index('-f') + 1], args[args.index('-of') + 1]\n"
        "with av.open(source) as container:\n"
        "    samples = sum(frame.samples for frame in container.decode(audio=0))\n"
        "row = {'text': f'{samples} samples', 'offsets': {'from': 0, 'to': 1}}\n"
        "with open(stem + '.json', 'w') as out:\n"
        "    json.dump({'transcription': [row]}, out)\n",
        encoding="utf-8",
    )
    cli.chmod(0o755)
    model = tmp_path / "model.bin"
    model.write_bytes(b"model")
    return WhisperCppCliSttProvider(executable=str(cli), model_path=model, timeout=30)


def provider_for(engine: str, tmp_path: Path, monkeypatch, heard: list[object]):
    if engine == "whisper.cpp":
        return whisper_cli_with_ffmpeg(tmp_path)
    monkeypatch.setattr(stt_adapter, "local_model_available", lambda _path: True)
    return _faster_whisper(heard)


@posix_only
@pytest.mark.parametrize("engine", ENGINES)
def test_speech_job_never_reads_a_playlist_segment_outside_the_evidence(
    client, tmp_path, monkeypatch, engine
):
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = Sentinel(outside / "segment.ts", tone(tmp_path / "tone.ts", "mpegts", "aac"))
    root = tmp_path / "evidence"
    root.mkdir()
    (root / "recording").write_text(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n"
        f"#EXTINF:1.0,\n{outside / 'segment.ts'}\n#EXT-X-ENDLIST\n",
        encoding="utf-8",
    )
    cid, nodes = nodes_of(client, root, "Playlist job")

    # Older FFmpeg builds detect HLS by content alone. Give the job's private copy an
    # .m3u8 name to recreate that on any build.
    class PlaylistNamedCopy(EvidenceFileContent):
        @classmethod
        @contextmanager
        def materialize(cls, *args, **kwargs):
            with EvidenceFileContent.materialize(*args, **kwargs) as path:
                yield path.rename(path.with_name("source.m3u8"))

    heard: list[object] = []
    provider = provider_for(engine, tmp_path, monkeypatch, heard)
    monkeypatch.setattr(machine, "EvidenceFileContent", PlaylistNamedCopy)
    monkeypatch.setattr(machine, "providers", lambda _root: (None, provider))
    # Leave the decision to the job: the pre-check learns nothing without ffprobe.
    monkeypatch.setattr(targets, "media_executable", lambda _name: None)

    body = stt(client, cid, nodes["recording"])
    assert body["ok"] is True, body
    try:
        task = finished(client, cid, body["data"]["task_id"])
    finally:
        sentinel.stop()
    assert not sentinel.opened, "the decoder opened a file outside the evidence"
    assert heard == []
    assert task["status"] == "FAILED", task
    assert task["error"]["code"] == "MEDIA_DECODE_FAILED"


@pytest.mark.parametrize(
    ("name", "container", "codec"),
    [("call.wav", "wav", "pcm_s16le"), ("memo.m4a", "ipod", "aac"), ("tape", "ipod", "aac")],
)
@pytest.mark.parametrize("engine", ENGINES)
def test_real_audio_still_decodes_under_the_input_limits(
    tmp_path, monkeypatch, engine, name, container, codec
):
    source = tmp_path / "source"
    source.write_bytes(tone(tmp_path / name, container, codec))
    heard: list[object] = []
    provider = provider_for(engine, tmp_path, monkeypatch, heard)
    if engine == "whisper.cpp":
        [row] = provider.analyze_audio(source)
        samples = int(row["text"].split()[0])
    else:
        assert provider._transcribe(source, None) == []
        [audio] = heard
        samples = len(audio)
    # One second at 16 kHz; AAC adds encoder padding.
    assert 16_000 <= samples <= 18_000

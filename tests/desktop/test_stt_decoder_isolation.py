"""A speech job decodes the evidence copy and nothing that copy names (#108)."""

import os
import sys
import threading
import time
from contextlib import contextmanager, suppress
from pathlib import Path
from types import SimpleNamespace

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


def tone(path: Path, container: str, codec: str, seconds: int = 1) -> bytes:
    """A 440 Hz tone, encoded by PyAV."""
    rate = 16_000
    wave = numpy.sin(2 * numpy.pi * 440 * numpy.arange(rate * seconds) / rate) * 8000
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


def damaged_in_the_middle(path: Path) -> bytes:
    """Two seconds of ADTS AAC whose middle packet no longer decodes."""
    data = bytearray(tone(path, "adts", "aac", seconds=2))
    with av.open(str(path)) as container:
        packets = [(p.pos, p.size) for p in container.demux(audio=0) if p.size]
    start, size = packets[len(packets) // 2]
    for index in range(start + 8, start + size):
        data[index] ^= 0xFF
    return bytes(data)


@pytest.mark.parametrize("engine", ENGINES)
def test_a_damaged_packet_keeps_later_audio_and_marks_the_result_partial(
    tmp_path, monkeypatch, engine
):
    source = tmp_path / "source"
    source.write_bytes(damaged_in_the_middle(tmp_path / "tone.aac"))
    heard: list[object] = []
    provider = provider_for(engine, tmp_path, monkeypatch, heard)
    if engine == "whisper.cpp":
        [row] = provider.analyze_audio(source)
        samples = int(row["text"].split()[0])
    else:
        segment = SimpleNamespace(text="heard", avg_logprob=0.0, start=0.0, end=2.0)
        provider._engine.transcribe = lambda audio, **_: (
            heard.append(audio) or iter([segment]),
            SimpleNamespace(language="en"),
        )
        [row] = provider._transcribe(source, None)
        [audio] = heard
        samples = len(audio)
    # Two seconds less one damaged AAC frame (1024 samples), not just the first half.
    assert samples >= 2 * 16_000 - 2048
    assert row["is_partial"] is True


@posix_only
@pytest.mark.parametrize("engine", ENGINES)
def test_decoding_counts_against_the_provider_timeout(tmp_path, monkeypatch, engine):
    source = tmp_path / "source"
    source.write_bytes(tone(tmp_path / "tone.aac", "adts", "aac", seconds=3))
    real = av.AudioResampler
    resampled: list[float] = []

    class SlowResampler:
        def __init__(self, *args, **kwargs):
            self._real = real(*args, **kwargs)

        def resample(self, frame):
            resampled.append(time.monotonic())
            time.sleep(0.05)
            return self._real.resample(frame)

    monkeypatch.setattr(av, "AudioResampler", SlowResampler)
    provider = provider_for(engine, tmp_path, monkeypatch, [])
    provider._timeout = 0.3
    started = time.monotonic()
    with pytest.raises(stt_adapter.UnsupportedCapabilityError) as error:
        provider.analyze_audio(source)
    assert "timed out" in error.value.developer_message
    assert time.monotonic() - started < 1.5
    # Decoding stops at the deadline instead of running on in the background.
    time.sleep(1.2)
    assert resampled[-1] - started < 1.0


def test_decoded_audio_longer_than_the_limit_is_refused(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.write_bytes(tone(tmp_path / "tone.wav", "wav", "pcm_s16le", seconds=2))
    monkeypatch.setattr(stt_adapter, "_MAX_AUDIO_SECONDS", 1)
    provider = provider_for("faster-whisper", tmp_path, monkeypatch, [])
    with pytest.raises(stt_adapter.UnsupportedCapabilityError) as error:
        provider._transcribe(source, None)
    assert "size limit" in error.value.developer_message

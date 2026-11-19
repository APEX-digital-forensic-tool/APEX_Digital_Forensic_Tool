"""Local STT runtime adapters."""

from __future__ import annotations

import hashlib
import importlib
import importlib.util
import json
import math
import shutil
import subprocess
import tempfile
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from pathlib import Path
from typing import Any

from apex_forensic._time import utc_now
from apex_forensic.constants import ENGINE_VERSION
from apex_forensic.domain.errors import (
    ApexError,
    OperationCancelledError,
    UnsupportedCapabilityError,
)
from apex_forensic.domain.models import ProviderCapability
from apex_forensic.runtime.media_inputs import pyav_container_options
from apex_forensic.runtime.subprocess_env import subprocess_environment

MAX_AUDIO_BYTES = 200 * 1024 * 1024
MAX_STT_OUTPUT_BYTES = 10 * 1024 * 1024
_SAMPLE_RATE = 16_000
# A longer recording cannot finish within the provider timeout; this also bounds memory.
_MAX_AUDIO_SECONDS = 2 * 60 * 60


def local_model_available(path: Path | None) -> bool:
    """Check a complete offline CTranslate2 bundle without loading model weights."""
    if path is None or not path.is_dir():
        return False
    try:
        required = [path / name for name in ("model.bin", "config.json", "tokenizer.json")]
        if not all(item.is_file() and item.stat().st_size > 0 for item in required):
            return False
        if not any(
            item.is_file() and item.stat().st_size > 0 for item in path.glob("vocabulary.*")
        ):
            return False
        for item in required[1:]:
            if item.stat().st_size > 32 * 1024 * 1024:
                return False
            if not isinstance(json.loads(item.read_text(encoding="utf-8")), dict):
                return False
    except (OSError, UnicodeError, ValueError):
        return False
    return True


class WhisperCppCliSttProvider:
    """Local STT provider using whisper.cpp style command line JSON output."""

    provider_id = "whisper.cpp-cli"
    provider_version = ENGINE_VERSION

    def __init__(
        self,
        *,
        executable: str = "whisper-cli",
        model_path: Path | None = None,
        timeout: float = 120.0,
    ) -> None:
        self._executable = executable
        self._model_path = model_path
        self._timeout = timeout

    def capabilities(self) -> ProviderCapability:
        executable = shutil.which(self._executable)
        model_available = self._model_path is not None and self._model_path.is_file()
        decoder_available = _module_available("av") and _module_available("numpy")
        available = executable is not None and model_available and decoder_available
        warnings: list[dict[str, Any]] = []
        if not decoder_available:
            warnings.append(
                {
                    "code": "CAPABILITY_UNAVAILABLE",
                    "developer_message": "PyAV or NumPy is missing; whisper.cpp needs both.",
                    "python_module": "av",
                }
            )
        if executable is None:
            warnings.append(
                {
                    "code": "CAPABILITY_UNAVAILABLE",
                    "developer_message": "whisper.cpp CLI is not installed or not on PATH.",
                    "binary": self._executable,
                }
            )
        if not model_available:
            warnings.append(
                {
                    "code": "CAPABILITY_UNAVAILABLE",
                    "developer_message": "STT model path is not configured or is unavailable.",
                    "model_path_configured": self._model_path is not None,
                }
            )
        return ProviderCapability(
            provider_id=self.provider_id,
            provider_version=self.provider_version,
            capability_type="STT",
            is_available=available,
            supported_inputs=["WAV", "MP3", "MP4_AUDIO_STREAM"] if available else [],
            supported_outputs=["MACHINE_EXTRACTED_CANDIDATE"],
            unavailable_reason=None if available else "CAPABILITY_UNAVAILABLE",
            warnings=warnings,
            metadata={
                "candidate_is_observed_fact": False,
                "binary": executable,
                "model_path_configured": self._model_path is not None,
                "model": self._model_metadata(),
            },
            updated_at=utc_now(),
        )

    def analyze_audio(
        self,
        path: Path,
        *,
        language: str | None = None,
        cancellation_requested: bool = False,
    ) -> list[dict[str, Any]]:
        if cancellation_requested:
            raise OperationCancelledError("STT analysis was cancelled before dispatch.")
        executable = shutil.which(self._executable)
        if (
            executable is None
            or self._model_path is None
            or not self._model_path.is_file()
            or not _module_available("av")
            or not _module_available("numpy")
        ):
            raise UnsupportedCapabilityError(
                "STT binary, model or audio decoder is unavailable.",
                target="stt_provider",
                required_capability="STT_RUNTIME",
            )
        resolved = path.resolve()
        if not resolved.is_file():
            raise UnsupportedCapabilityError("STT source audio is unavailable.", target="path")
        if resolved.stat().st_size > MAX_AUDIO_BYTES:
            raise UnsupportedCapabilityError(
                "STT source audio exceeds the size limit.",
                target="path",
            )
        deadline = time.monotonic() + self._timeout
        pcm, partial = _decoded_pcm(resolved, deadline)
        with tempfile.TemporaryDirectory(prefix="apex-stt-") as temp_dir:
            # whisper-cli may be built with FFmpeg and cannot take input limits, so it
            # only ever reads this WAV, never the evidence copy.
            audio = Path(temp_dir) / "audio.wav"
            with wave.open(str(audio), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(_SAMPLE_RATE)
                output.writeframes(pcm.astype("<i2").tobytes())
            output_stem = Path(temp_dir) / "transcript"
            command = [
                executable,
                "-m",
                str(self._model_path.resolve()),
                "-f",
                str(audio),
                "-oj",
                "-of",
                str(output_stem),
            ]
            command.extend(["-l", language or "auto"])
            try:
                completed = subprocess.run(
                    command,
                    check=False,
                    capture_output=True,
                    timeout=max(0.0, deadline - time.monotonic()),
                    env=subprocess_environment(),
                )
            except subprocess.TimeoutExpired as exc:
                raise _timed_out() from exc
            # whisper.cpp reports input it cannot read this way, sometimes with exit code 0.
            if b"failed to read audio" in completed.stderr:
                raise ApexError("MEDIA_DECODE_FAILED", "error.media_decode_failed")
            if completed.returncode != 0:
                raise UnsupportedCapabilityError(
                    "STT provider failed to analyze the audio.",
                    target="stt_provider",
                    required_capability="STT_RUNTIME",
                )
            json_path = output_stem.with_suffix(".json")
            if not json_path.is_file() or json_path.stat().st_size > MAX_STT_OUTPUT_BYTES:
                raise UnsupportedCapabilityError("STT provider output is missing or too large.")
            try:
                payload = json.loads(json_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise UnsupportedCapabilityError("STT provider output is corrupt.") from exc
        model_info = payload.get("model", {}) if isinstance(payload, dict) else {}
        if language not in {None, "en"} and model_info.get("multilingual") is False:
            raise ApexError("STT_LANGUAGE_UNSUPPORTED", "error.stt_language_unsupported")
        rows = _segments(payload, language)
        source_sha256 = _file_sha256(resolved)
        for row in rows:
            row["source_sha256"] = source_sha256
            row["model_id"] = f"whisper.cpp:{self._model_path.name}"
            row["is_partial"] = partial
        return rows

    def _model_metadata(self) -> dict[str, Any]:
        if self._model_path is None:
            return {
                "path": None,
                "available": False,
                "sha256": None,
                "version": None,
            }
        resolved = self._model_path.resolve()
        if not resolved.is_file():
            return {
                "path": str(resolved),
                "available": False,
                "sha256": None,
                "version": None,
            }
        return {
            "path": str(resolved),
            "available": True,
            "sha256": _file_sha256(resolved),
            "version": resolved.name,
            "size": resolved.stat().st_size,
        }


class FasterWhisperSttProvider:
    """Local STT provider using a caller-supplied faster-whisper model directory.

    The adapter deliberately does not download models. A model path must be supplied by config,
    environment, or CLI, and tests can skip cleanly when the optional dependency/model is absent.
    """

    provider_id = "faster-whisper-local"
    provider_version = ENGINE_VERSION

    def __init__(
        self,
        *,
        model_path: Path | None = None,
        device: str = "cpu",
        compute_type: str = "int8",
        timeout: float = 120.0,
    ) -> None:
        self._model_path = model_path
        self._device = device
        self._compute_type = compute_type
        self._timeout = timeout
        self._engine: Any | None = None

    def capabilities(self) -> ProviderCapability:
        dependency_available = _module_available("faster_whisper")
        model_available = local_model_available(self._model_path)
        available = dependency_available and model_available
        warnings: list[dict[str, Any]] = []
        if not dependency_available:
            warnings.append(
                {
                    "code": "CAPABILITY_UNAVAILABLE",
                    "developer_message": "faster-whisper package is not installed.",
                    "python_module": "faster_whisper",
                }
            )
        if not model_available:
            warnings.append(
                {
                    "code": "CAPABILITY_UNAVAILABLE",
                    "developer_message": "STT model path is not configured or is unavailable.",
                    "model_path_configured": self._model_path is not None,
                }
            )
        return ProviderCapability(
            provider_id=self.provider_id,
            provider_version=self.provider_version,
            capability_type="STT",
            is_available=available,
            supported_inputs=["WAV", "MP3", "MP4_AUDIO_STREAM"] if available else [],
            supported_outputs=["MACHINE_EXTRACTED_CANDIDATE"],
            unavailable_reason=None if available else "CAPABILITY_UNAVAILABLE",
            warnings=warnings,
            metadata={
                "candidate_is_observed_fact": False,
                "engine": "faster-whisper",
                "device": self._device,
                "compute_type": self._compute_type,
                "languages": ["auto", "en", "ko"],
                "model": self._model_metadata(),
                "model_auto_download": False,
            },
            updated_at=utc_now(),
        )

    def analyze_audio(
        self,
        path: Path,
        *,
        language: str | None = None,
        cancellation_requested: bool = False,
    ) -> list[dict[str, Any]]:
        if cancellation_requested:
            raise OperationCancelledError("STT analysis was cancelled before dispatch.")
        if not _module_available("faster_whisper") or not local_model_available(self._model_path):
            raise UnsupportedCapabilityError(
                "faster-whisper or the configured local model is unavailable.",
                target="stt_provider",
                required_capability="STT_RUNTIME",
            )
        resolved = path.resolve()
        if not resolved.is_file():
            raise UnsupportedCapabilityError("STT source audio is unavailable.", target="path")
        if resolved.stat().st_size > MAX_AUDIO_BYTES:
            raise UnsupportedCapabilityError(
                "STT source audio exceeds the size limit.",
                target="path",
            )
        deadline = time.monotonic() + self._timeout
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="apex-stt")
        future = executor.submit(self._transcribe, resolved, language, deadline)
        try:
            return future.result(timeout=self._timeout)
        except FutureTimeoutError as exc:
            future.cancel()
            raise _timed_out() from exc
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def _transcribe(
        self, path: Path, language: str | None, deadline: float = math.inf
    ) -> list[dict[str, Any]]:
        engine = self._faster_whisper_engine()
        if language not in {None, "en"} and not engine.model.is_multilingual:
            raise ApexError("STT_LANGUAGE_UNSUPPORTED", "error.stt_language_unsupported")
        pcm, partial = _decoded_pcm(path, deadline)
        segments, info = engine.transcribe(
            pcm.astype("float32") / 32768.0,
            language=language,
            vad_filter=False,
            word_timestamps=False,
        )
        detected_language = str(getattr(info, "language", "") or language or "") or None
        model_id = None if self._model_path is None else self._model_path.resolve().name
        source_sha256 = _file_sha256(path)
        rows: list[dict[str, Any]] = []
        for segment in segments:
            text = str(getattr(segment, "text", "") or "").strip()
            if not text:
                continue
            avg_logprob = getattr(segment, "avg_logprob", None)
            rows.append(
                {
                    "text": text,
                    "language": detected_language,
                    "confidence": _logprob_confidence(avg_logprob),
                    "audio_start_ms": _milliseconds(getattr(segment, "start", None)),
                    "audio_end_ms": _milliseconds(getattr(segment, "end", None)),
                    "model_id": f"faster-whisper:{model_id}" if model_id else "faster-whisper",
                    "source_sha256": source_sha256,
                    "is_partial": partial,
                }
            )
        return rows

    def _faster_whisper_engine(self) -> Any:
        if self._engine is None:
            importlib.import_module("onnxruntime").disable_telemetry_events()
            module = importlib.import_module("faster_whisper")
            self._engine = module.WhisperModel(
                str(self._model_path.resolve()) if self._model_path is not None else "",
                device=self._device,
                compute_type=self._compute_type,
                local_files_only=True,
            )
        return self._engine

    def _model_metadata(self) -> dict[str, Any]:
        if self._model_path is None:
            return {
                "path": None,
                "available": False,
                "sha256": None,
                "version": None,
            }
        resolved = self._model_path.resolve()
        if not local_model_available(resolved):
            return {
                "path": str(resolved),
                "available": False,
                "sha256": None,
                "version": None,
            }
        return {
            "path": str(resolved),
            "available": True,
            "sha256": _path_sha256(resolved),
            "version": resolved.name,
            "size": _path_size(resolved),
        }


def _decoded_pcm(path: Path, deadline: float) -> tuple[Any, bool]:
    """16 kHz mono 16-bit samples from this copy and nothing else, and whether any were lost.

    A packet that does not decode is skipped and the rest still decodes; the caller marks
    the result partial so the analyst knows the transcript does not cover all the audio.
    """
    av = importlib.import_module("av")
    numpy = importlib.import_module("numpy")
    resampler = av.AudioResampler(format="s16", layout="mono", rate=_SAMPLE_RATE)
    chunks: list[Any] = []
    samples = 0
    skipped = 0

    def keep(frames: list[Any]) -> None:
        nonlocal samples
        for out in frames:
            chunks.append(out.to_ndarray().reshape(-1))
            samples += out.samples
        if samples > _MAX_AUDIO_SECONDS * _SAMPLE_RATE:
            raise UnsupportedCapabilityError(
                "STT source audio exceeds the size limit.", target="path"
            )

    try:
        with av.open(
            str(path), container_options=pyav_container_options(), metadata_errors="ignore"
        ) as container:
            if not container.streams.audio:
                raise ApexError(
                    "MEDIA_AUDIO_FORMAT_UNSUPPORTED", "error.media_audio_format_unsupported"
                )
            for packet in container.demux(container.streams.audio[0]):
                if time.monotonic() > deadline:
                    raise _timed_out()
                try:
                    frames = packet.decode()
                except av.error.InvalidDataError:
                    skipped += 1
                    continue
                for frame in frames:
                    keep(resampler.resample(frame))
            keep(resampler.resample(None))
    except av.error.FFmpegError as error:
        raise ApexError("MEDIA_DECODE_FAILED", "error.media_decode_failed") from error
    if skipped and not chunks:
        raise ApexError("MEDIA_DECODE_FAILED", "error.media_decode_failed")
    pcm = numpy.concatenate(chunks) if chunks else numpy.zeros(0, dtype=numpy.int16)
    return pcm, skipped > 0


def _timed_out() -> UnsupportedCapabilityError:
    return UnsupportedCapabilityError(
        "STT provider timed out while analyzing the audio.",
        target="stt_provider",
        required_capability="STT_RUNTIME",
    )


def _segments(payload: Any, language: str | None) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    raw_segments = payload.get("transcription") or payload.get("segments") or []
    if not isinstance(raw_segments, list):
        return []
    detected = payload.get("result", {})
    detected_language = detected.get("language") if isinstance(detected, dict) else None
    rows: list[dict[str, Any]] = []
    for segment in raw_segments:
        if not isinstance(segment, dict):
            continue
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        rows.append(
            {
                "text": text,
                "language": detected_language or segment.get("language") or language,
                "confidence": _score(segment.get("confidence", segment.get("probability"))),
                "audio_start_ms": _segment_time(segment, "from", "start", "t0"),
                "audio_end_ms": _segment_time(segment, "to", "end", "t1"),
            }
        )
    return rows


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _path_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    if path.is_file():
        return _file_sha256(path)
    for item in sorted(child for child in path.rglob("*") if child.is_file()):
        relative = item.relative_to(path).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        digest.update(item.stat().st_size.to_bytes(8, "big"))
        with item.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def _path_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def _segment_time(row: dict[str, Any], offset: str, seconds: str, ticks: str) -> int | None:
    # whisper.cpp JSON offsets are milliseconds; t0/t1 are 10 ms ticks.
    offsets = row.get("offsets")
    if isinstance(offsets, dict) and offset in offsets:
        return _milliseconds(offsets[offset], scale=1)
    if seconds in row:
        return _milliseconds(row[seconds])
    return _milliseconds(row.get(ticks), scale=10)


def _milliseconds(value: Any, *, scale: int = 1000) -> int | None:
    if (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    ):
        return round(value * scale)
    return None


def _score(value: Any) -> float:
    if isinstance(value, int | float):
        return max(0.0, min(1.0, float(value)))
    return 0.0


def _logprob_confidence(value: Any) -> float:
    if isinstance(value, int | float):
        return max(0.0, min(1.0, math.exp(float(value))))
    return 0.0


def _module_available(module_name: str) -> bool:
    try:
        return importlib.util.find_spec(module_name) is not None
    except (ImportError, ModuleNotFoundError, ValueError):
        return False

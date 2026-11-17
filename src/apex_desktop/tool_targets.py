"""Reject known incompatible speech targets before creating a background task."""

import subprocess
from typing import Any

from apex_forensic.adapters.filesystem.content import EvidenceFileContent
from apex_forensic.domain.errors import ApexError
from apex_forensic.domain.models.filesystem import FileSystemNode
from apex_forensic.runtime.assets import media_executable
from apex_forensic.runtime.subprocess_env import subprocess_environment

# Demuxers that carry speech; ffprobe may not open the file as any other format.
_AUDIO_FORMATS = "mov,mp3,aac,wav,w64,flac,ogg,matroska,webm,avi,asf,caf,amr,aiff,mpeg,mpegts"
_PROBE_SECONDS = 10
_PROBE_MAX_BYTES = 64 * 1024 * 1024


def _has_audio_stream(evidence: Any, node: FileSystemNode) -> bool | None:
    """Ask ffprobe whether the file has an audio stream; None when it cannot be asked.

    A RawReadError (source changed, outside the evidence, unreadable node) goes out with its
    own code. Other failures leave the decision to the name, then to the job.
    """
    try:
        with EvidenceFileContent.open(evidence, node) as handle:
            EvidenceFileContent.read_range(handle, 0, min(node.file_size or 0, 1))
    except OSError:
        return None
    ffprobe = media_executable("ffprobe")
    if ffprobe is None or (node.file_size or 0) > _PROBE_MAX_BYTES:
        return None
    try:
        with EvidenceFileContent.materialize(evidence, node) as path:
            completed = _run(
                ffprobe,
                *("-v", "error", "-protocol_whitelist", "file"),
                *("-format_whitelist", _AUDIO_FORMATS),
                *("-select_streams", "a", "-show_entries", "stream=codec_type"),
                *("-of", "csv=p=0", str(path)),
            )
        if b"audio" in completed.stdout.split():
            return True
        # ffprobe exits 1 for input it cannot open, which is the usual "not audio" answer.
        # A crash, or an ffprobe that cannot even report its version, says nothing.
        if completed.returncode < 0 or (
            completed.returncode != 0 and _run(ffprobe, "-version").returncode != 0
        ):
            return None
    except (OSError, subprocess.TimeoutExpired):
        return None
    return False


def _run(*command: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        command,
        capture_output=True,
        env=subprocess_environment(),
        timeout=_PROBE_SECONDS,
        check=False,
    )


def require_speech_source(node: FileSystemNode, evidence: Any) -> None:
    if node.node_type.value != "FILE":
        raise _unsupported()
    # The bytes decide (voice.dat holding m4a, a WAV named note.txt, text named a.wav).
    has_audio = _has_audio_stream(evidence, node)
    if has_audio is not None:
        if not has_audio:
            raise _unsupported()
        return
    # The bytes could not be judged, so the name is the only evidence left. An unclear
    # name is queued, and the decoder reports its own MEDIA code.
    mime = (node.mime_candidate or "").lower()
    if mime.startswith(("image/", "text/")):
        raise _unsupported()


def _unsupported() -> ApexError:
    return ApexError(
        "MEDIA_AUDIO_FORMAT_UNSUPPORTED",
        "error.media_audio_format_unsupported",
        target="node_id",
    )

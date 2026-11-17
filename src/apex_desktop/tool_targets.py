"""Reject known incompatible speech targets before creating a background task."""

import subprocess
from typing import Any

from apex_forensic.adapters.filesystem.content import EvidenceFileContent
from apex_forensic.domain.errors import ApexError
from apex_forensic.domain.models.filesystem import FileSystemNode
from apex_forensic.runtime.assets import media_executable
from apex_forensic.runtime.subprocess_env import subprocess_environment

_AUDIO_VIDEO = frozenset(
    {
        "wav",
        "mp3",
        "m4a",
        "aac",
        "flac",
        "ogg",
        "oga",
        "opus",
        "wma",
        "amr",
        "caf",
        "aif",
        "aiff",
        "mp4",
        "m4v",
        "mov",
        "mkv",
        "avi",
        "webm",
        "wmv",
        "3gp",
    }
)


# Demuxers that carry speech; text, images and archives are never probed as media.
_AUDIO_FORMATS = "mov,mp3,aac,wav,w64,flac,ogg,matroska,webm,avi,asf,caf,amr,aiff,mpeg,mpegts"
_PROBE_SECONDS = 10
_PROBE_MAX_BYTES = 64 * 1024 * 1024


def _has_audio_stream(evidence: Any, node: FileSystemNode) -> bool | None:
    """Ask ffprobe whether the file has an audio stream; None when it cannot be asked.

    A RawReadError (source changed, outside the evidence, unreadable node) goes out with its
    own code. Other failures leave the decision to the job, which reports its real error.
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
            completed = subprocess.run(
                [
                    ffprobe,
                    *("-v", "error", "-protocol_whitelist", "file"),
                    *("-format_whitelist", _AUDIO_FORMATS),
                    *("-select_streams", "a", "-show_entries", "stream=codec_type"),
                    *("-of", "csv=p=0", str(path)),
                ],
                capture_output=True,
                env=subprocess_environment(),
                timeout=_PROBE_SECONDS,
                check=False,
            )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return b"audio" in completed.stdout.split()


def require_speech_source(node: FileSystemNode, evidence: Any = None) -> None:
    if node.node_type.value != "FILE":
        raise _unsupported()
    extension = (node.extension or "").lower().lstrip(".")
    mime = (node.mime_candidate or "").lower()
    if mime.startswith(("image/", "text/")):
        raise _unsupported()
    if extension in _AUDIO_VIDEO or mime.startswith(("audio/", "video/")):
        return
    # No name or a misleading one (voice.dat holding m4a, Android .3ga): ffprobe decides.
    # When it cannot be asked, the job is queued and the decoder reports its own MEDIA code.
    if evidence is None:
        if not extension and not mime:
            return
        raise _unsupported()
    if _has_audio_stream(evidence, node) is False:
        raise _unsupported()


def _unsupported() -> ApexError:
    return ApexError(
        "MEDIA_AUDIO_FORMAT_UNSUPPORTED",
        "error.media_audio_format_unsupported",
        target="node_id",
    )

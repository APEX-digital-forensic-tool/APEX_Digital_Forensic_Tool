"""Reject known incompatible speech targets before creating a background task."""

from typing import Any

from apex_forensic.adapters.filesystem.content import EvidenceFileContent
from apex_forensic.domain.errors import ApexError
from apex_forensic.domain.models.filesystem import FileSystemNode

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


def _is_mpeg_audio_frame(head: bytes) -> bool:
    """MPEG audio or ADTS frame header with no reserved field values."""
    if len(head) < 3 or head[0] != 0xFF or head[1] & 0xE0 != 0xE0:
        return False
    version, layer = (head[1] >> 3) & 3, (head[1] >> 1) & 3
    bitrate, rate = head[2] >> 4, (head[2] >> 2) & 3
    if layer == 0:  # ADTS AAC always has layer bits 00
        return head[1] & 0xF6 == 0xF0 and rate != 3
    return version != 1 and bitrate != 0xF and rate != 3


def _is_media_header(head: bytes) -> bool:
    return (
        head[4:8] == b"ftyp"  # MP4, M4A, 3GP/3GA, MOV
        or head[:4] in {b"OggS", b"fLaC", b"FORM", b"caff", b"\x1aE\xdf\xa3", b"0&\xb2u"}
        or head[:3] == b"ID3"
        or head[:5] == b"#!AMR"
        or (head[:4] == b"RIFF" and head[8:12] in {b"WAVE", b"AVI "})
        or _is_mpeg_audio_frame(head)
    )


def _looks_like_media(evidence: Any, node: FileSystemNode) -> bool:
    size = node.file_size or 0
    with EvidenceFileContent.open(evidence, node) as handle:
        return _is_media_header(EvidenceFileContent.read_range(handle, 0, min(size, 64)))


def require_speech_source(node: FileSystemNode, evidence: Any = None) -> None:
    extension = (node.extension or "").lower().lstrip(".")
    mime = (node.mime_candidate or "").lower()
    # Unknown labels may be extensionless evidence. Let the actual decoder decide.
    if node.node_type.value == "FILE" and not extension and not mime:
        return
    if node.node_type.value != "FILE":
        raise _unsupported()
    if extension in _AUDIO_VIDEO or mime.startswith(("audio/", "video/")):
        return
    # A misleading name (voice.dat holding m4a, Android .3ga): the bytes decide.
    if evidence is not None and _looks_like_media(evidence, node):
        return
    raise _unsupported()


def _unsupported() -> ApexError:
    return ApexError(
        "MEDIA_AUDIO_FORMAT_UNSUPPORTED",
        "error.media_audio_format_unsupported",
        target="node_id",
    )

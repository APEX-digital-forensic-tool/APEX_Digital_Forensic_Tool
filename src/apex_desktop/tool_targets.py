"""Which targets each analysis tool can work on, checked before a task is queued."""

from typing import Any

from apex_forensic.adapters.filesystem.content import EvidenceFileContent
from apex_forensic.domain.errors import ApexError

IMAGE_EXTENSIONS = frozenset({"png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "webp"})
AUDIO_VIDEO_EXTENSIONS = frozenset(
    {"wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "amr", "caf", "aif", "aiff"}
    | {"mp4", "m4v", "mov", "mkv", "avi", "webm", "wmv", "3gp"}
)


def _extension(node: Any) -> str:
    return (node.extension or "").lower().lstrip(".")


def require_carvable(evidence: Any) -> None:
    """Carving scans raw image bytes; a folder has none to scan."""
    if evidence.evidence_type.value == "DIRECTORY":
        raise ApexError(
            "CARVING_REQUIRES_IMAGE", "error.carving_requires_image", target="evidence_id"
        )


def require_machine_source(node: Any, kind: str, evidence: Any = None) -> None:
    """STT needs an audio or video file; OCR is decided by the file's bytes, not its name."""
    if kind == "OCR":
        if evidence is not None:
            _require_decodable_image(evidence, node)
        return
    mime = (node.mime_candidate or "").lower()
    named = _extension(node)
    if named in AUDIO_VIDEO_EXTENSIONS or mime.startswith(("audio/", "video/")):
        return
    # The name says nothing useful (or something else): the bytes decide.
    if evidence is not None and _looks_like_media(evidence, node):
        return
    raise ApexError(
        "MEDIA_AUDIO_FORMAT_UNSUPPORTED", "error.media_audio_format_unsupported", target="node_id"
    )


def _is_mpeg_audio_frame(head: bytes) -> bool:
    """MPEG audio or ADTS frame header with no reserved field values."""
    if len(head) < 3 or head[0] != 0xFF or head[1] & 0xE0 != 0xE0:
        return False
    version, layer = (head[1] >> 3) & 3, (head[1] >> 1) & 3
    bitrate, rate = head[2] >> 4, (head[2] >> 2) & 3
    if layer == 0:  # ADTS AAC always has layer bits 00
        return head[1] & 0xF6 == 0xF0 and rate != 3
    return version != 1 and bitrate not in {0xF} and rate != 3


def _is_media_header(head: bytes) -> bool:
    return (
        head[4:8] == b"ftyp"  # MP4, M4A, 3GP/3GA, MOV
        or head[:4] in {b"OggS", b"fLaC", b"FORM", b"caff", b"\x1aE\xdf\xa3", b"0&\xb2u"}
        or head[:3] == b"ID3"
        or head[:5] == b"#!AMR"
        or (head[:4] == b"RIFF" and head[8:12] in {b"WAVE", b"AVI "})
        or _is_mpeg_audio_frame(head)
    )


def _looks_like_media(evidence: Any, node: Any) -> bool:
    return _is_media_header(_header(evidence, node, 64))


def _header(evidence: Any, node: Any, length: int) -> bytes:
    size = node.file_size or 0
    with EvidenceFileContent.open(evidence, node) as handle:
        return bytes(EvidenceFileContent.read_range(handle, 0, min(size, length)))


def _is_known_image(head: bytes) -> bool:
    return (
        head.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a", b"BM"))
        or head[:4] in {b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"}
        or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")
    )


def _require_decodable_image(evidence: Any, node: Any) -> None:
    """Prove only that the bytes start like an image format we know.

    A header window cannot decode every format (a TIFF's directory may sit at the end of the
    file), so real decode failures are left to the job, which reports them as MEDIA_* codes.
    """
    head = _header(evidence, node, 16)
    if not _is_known_image(head):
        # A name that does not claim to be an image gets the format message, not a decode one.
        code = (
            "MEDIA_DECODE_FAILED"
            if _extension(node) in IMAGE_EXTENSIONS
            else "MEDIA_FORMAT_UNSUPPORTED"
        )
        raise ApexError(code, f"error.{code.lower()}", target="node_id")

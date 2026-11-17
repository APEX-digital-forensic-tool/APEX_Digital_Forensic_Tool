"""Which targets each analysis tool can work on, checked before a task is queued."""

import importlib
from io import BytesIO
from typing import Any

from apex_forensic.adapters.filesystem.content import EvidenceFileContent
from apex_forensic.domain.errors import ApexError

IMAGE_EXTENSIONS = frozenset({"png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "webp"})
AUDIO_VIDEO_EXTENSIONS = frozenset(
    {"wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "amr"}
    | {"mp4", "m4v", "mov", "mkv", "avi", "webm", "wmv", "3gp"}
)


_HEADER_BYTES = 4 * 1024 * 1024


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


def _looks_like_media(evidence: Any, node: Any) -> bool:
    size = node.file_size or 0
    with EvidenceFileContent.open(evidence, node) as handle:
        head = EvidenceFileContent._read(handle, 0, min(size, 64))
    return (
        head[4:8] == b"ftyp"  # MP4, M4A, 3GP/3GA, MOV
        or head[:4] in {b"OggS", b"fLaC", b"FORM", b"\x1aE\xdf\xa3", b"0&\xb2u"}
        or head[:3] == b"ID3"
        or head[:5] == b"#!AMR"
        or (head[:4] == b"RIFF" and head[8:12] in {b"WAVE", b"AVI "})
        or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)  # MPEG/ADTS sync
    )


def _require_decodable_image(evidence: Any, node: Any) -> None:
    """Open only the header; files larger than the header window are not rejected for size."""
    pillow = importlib.import_module("PIL.Image")
    size = node.file_size or 0
    with EvidenceFileContent.open(evidence, node) as handle:
        head = EvidenceFileContent._read(handle, 0, min(size, _HEADER_BYTES))
    try:
        with pillow.open(BytesIO(head)):
            pass
    except pillow.DecompressionBombError as error:
        raise ApexError(
            "MEDIA_LIMIT_EXCEEDED", "error.media_limit_exceeded", target="node_id"
        ) from error
    except Exception as error:  # Pillow raises UnidentifiedImageError, OSError or ValueError.
        # A name that does not claim to be an image gets the format message, not a decode one.
        code = (
            "MEDIA_DECODE_FAILED"
            if _extension(node) in IMAGE_EXTENSIONS
            else ("MEDIA_FORMAT_UNSUPPORTED")
        )
        raise ApexError(code, f"error.{code.lower()}", target="node_id") from error

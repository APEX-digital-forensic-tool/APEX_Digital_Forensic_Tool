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
    if named and named not in AUDIO_VIDEO_EXTENSIONS and not mime.startswith(("audio/", "video/")):
        raise ApexError(
            "MEDIA_AUDIO_FORMAT_UNSUPPORTED",
            "error.media_audio_format_unsupported",
            target="node_id",
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

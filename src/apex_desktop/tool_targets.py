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
    """OCR needs an image file and STT an audio or video file.

    A file without an extension is judged by its bytes (OCR) or left to the decoder (STT).
    """
    mime = (node.mime_candidate or "").lower()
    unknown = _extension(node) == ""
    if kind == "OCR":
        fits = unknown or _extension(node) in IMAGE_EXTENSIONS or mime.startswith("image/")
        code = "MEDIA_FORMAT_UNSUPPORTED"
    else:
        fits = (
            unknown
            or _extension(node) in AUDIO_VIDEO_EXTENSIONS
            or mime.startswith(("audio/", "video/"))
        )
        code = "MEDIA_AUDIO_FORMAT_UNSUPPORTED"
    if not fits:
        raise ApexError(code, f"error.{code.lower()}", target="node_id")
    if kind == "OCR" and evidence is not None:
        _require_decodable_image(evidence, node)


def _require_decodable_image(evidence: Any, node: Any) -> None:
    pillow = importlib.import_module("PIL.Image")
    head = b"".join(EvidenceFileContent.chunks(evidence, node, limit=_HEADER_BYTES))
    try:
        with pillow.open(BytesIO(head)):
            pass
    except Exception as error:  # Pillow raises UnidentifiedImageError, OSError or ValueError.
        raise ApexError(
            "MEDIA_DECODE_FAILED", "error.media_decode_failed", target="node_id"
        ) from error

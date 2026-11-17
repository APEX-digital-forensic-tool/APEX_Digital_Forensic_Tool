"""Which targets each analysis tool can work on, checked before a task is queued."""

from typing import Any

from apex_forensic.domain.errors import ApexError

IMAGE_EXTENSIONS = frozenset({"png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "webp"})
AUDIO_VIDEO_EXTENSIONS = frozenset(
    {"wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "amr"}
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


def require_machine_source(node: Any, kind: str) -> None:
    """OCR needs an image file and STT an audio or video file."""
    mime = (node.mime_candidate or "").lower()
    if kind == "OCR":
        fits = _extension(node) in IMAGE_EXTENSIONS or mime.startswith("image/")
        code = "MEDIA_FORMAT_UNSUPPORTED"
    else:
        fits = _extension(node) in AUDIO_VIDEO_EXTENSIONS or mime.startswith(("audio/", "video/"))
        code = "MEDIA_AUDIO_FORMAT_UNSUPPORTED"
    if not fits:
        raise ApexError(code, f"error.{code.lower()}", target="node_id")

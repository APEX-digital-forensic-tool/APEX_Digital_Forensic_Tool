"""Reject known incompatible speech targets before creating a background task."""

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


def require_speech_source(node: FileSystemNode) -> None:
    extension = (node.extension or "").lower().lstrip(".")
    mime = (node.mime_candidate or "").lower()
    # Unknown labels may be extensionless evidence. Let the actual decoder decide.
    if node.node_type.value == "FILE" and not extension and not mime:
        return
    if node.node_type.value != "FILE" or (
        extension not in _AUDIO_VIDEO and not mime.startswith(("audio/", "video/"))
    ):
        raise ApexError(
            "MEDIA_AUDIO_FORMAT_UNSUPPORTED",
            "error.media_audio_format_unsupported",
            target="node_id",
        )

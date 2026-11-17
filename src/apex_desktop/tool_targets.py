"""Refuse speech targets before creating a background task, only on positive evidence."""

import functools
import subprocess
from enum import Enum

from apex_forensic.adapters.filesystem.content import EvidenceFileContent
from apex_forensic.domain.errors import ApexError
from apex_forensic.domain.models.evidence import Evidence
from apex_forensic.domain.models.filesystem import FileSystemNode
from apex_forensic.runtime.assets import media_executable
from apex_forensic.runtime.subprocess_env import subprocess_environment

_PROBE_SECONDS = 10
_PROBE_MAX_BYTES = 64 * 1024 * 1024
# Demuxers that open other inputs named inside the file (playlists, concat lists, manifests,
# filter graphs, scripts, image sequences, network descriptions). The probe reads only the copy.
_REFERENCING_DEMUXERS = frozenset(
    {
        "hls",
        "applehttp",
        "concat",
        "dash",
        "imf",
        "webm_dash_manifest",
        "lavfi",
        "avisynth",
        "vapoursynth",
        "dvdvideo",
        "image2",
        "sdp",
        "rtsp",
        "rtp",
    }
)


class _Probe(Enum):
    AUDIO = "audio"
    # ffprobe opened the container and it has no audio stream.
    NO_AUDIO = "no_audio"
    # A working ffprobe could not open the bytes as any format it knows.
    UNREADABLE = "unreadable"
    # Nothing was learned: no ffprobe, too large, a crash, a timeout, an OS error.
    UNKNOWN = "unknown"


def _probe(evidence: Evidence, node: FileSystemNode) -> _Probe:
    """Ask ffprobe about the bytes. A RawReadError goes out with its own code."""
    try:
        EvidenceFileContent.read(evidence, node, offset=0, length=min(node.file_size or 0, 1))
    except OSError:
        return _Probe.UNKNOWN
    ffprobe = media_executable("ffprobe")
    if ffprobe is None or (node.file_size or 0) > _PROBE_MAX_BYTES:
        return _Probe.UNKNOWN
    try:
        formats = _self_contained_demuxers(ffprobe)
        if formats is None:
            return _Probe.UNKNOWN
        # A private temporary copy, opened only through the file protocol.
        with EvidenceFileContent.materialize(evidence, node) as path:
            completed = _run(
                ffprobe,
                *("-v", "error", "-protocol_whitelist", "file"),
                *("-format_whitelist", formats),
                *("-select_streams", "a", "-show_entries", "stream=codec_type"),
                *("-of", "csv=p=0", f"file:{path}"),
            )
        if b"audio" in completed.stdout.split():
            return _Probe.AUDIO
        if completed.returncode == 0:
            return _Probe.NO_AUDIO
        # Exit 1 is ffprobe's answer for bytes it cannot open, but only when ffprobe
        # itself runs; a crash or a broken install says nothing about the file.
        if completed.returncode > 0 and _run(ffprobe, "-version").returncode == 0:
            return _Probe.UNREADABLE
    except (OSError, subprocess.TimeoutExpired):
        pass
    return _Probe.UNKNOWN


@functools.cache
def _self_contained_demuxers(ffprobe: str) -> str | None:
    """Every demuxer this ffprobe has, minus devices and those that open other inputs."""
    completed = _run(ffprobe, "-hide_banner", "-demuxers")
    if completed.returncode != 0:
        return None
    rows = completed.stdout.decode("utf-8", "replace").splitlines()
    divider = next((i for i, row in enumerate(rows) if row.strip() == "---"), None)
    if divider is None:
        return None
    names: list[str] = []
    # Rows read " D   name   description", with "d" in the flags for a device.
    for row in rows[divider + 1 :]:
        flags, columns = row[1:4], row[5:].split()
        if not columns or "D" not in flags or "d" in flags:
            continue
        aliases = columns[0].split(",")
        if not _REFERENCING_DEMUXERS.intersection(aliases):
            names.extend(aliases)
    return ",".join(names) or None


def _run(*command: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        command,
        capture_output=True,
        env=subprocess_environment(),
        timeout=_PROBE_SECONDS,
        check=False,
    )


def require_speech_source(node: FileSystemNode, evidence: Evidence) -> None:
    if node.node_type.value != "FILE":
        raise _unsupported()
    probe = _probe(evidence, node)
    if probe is _Probe.NO_AUDIO:
        raise _unsupported()
    # Unopenable bytes under a text or image name: both point away from audio. Under any
    # other name, or when nothing was learned, the job runs and reports what it finds.
    mime = (node.mime_candidate or "").lower()
    if probe is _Probe.UNREADABLE and mime.startswith(("image/", "text/")):
        raise _unsupported()


def _unsupported() -> ApexError:
    return ApexError(
        "MEDIA_AUDIO_FORMAT_UNSUPPORTED",
        "error.media_audio_format_unsupported",
        target="node_id",
    )

"""Open evidence with FFmpeg so that only the given copy is read.

Every decoder that reads evidence (ffprobe, ffmpeg, PyAV) gets the same two limits: the
file protocol only, and only demuxers that read their own input. Each FFmpeg build has its
own demuxer set, so the format list is derived from the build that will open the file.
"""

import functools
import importlib
import subprocess
from collections.abc import Iterable

from apex_forensic.runtime.subprocess_env import subprocess_environment

PROTOCOLS = "file"
# Demuxers that open other inputs named inside the file (playlists, concat lists, manifests,
# filter graphs, scripts, image sequences, network descriptions and listeners).
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
        "sap",
    }
)


def _self_contained(demuxers: Iterable[tuple[list[str], bool]]) -> str:
    """Names of demuxers that are not excluded and open nothing but their input."""
    names = {
        alias: None
        for aliases, excluded in demuxers
        if not excluded and not _REFERENCING_DEMUXERS.intersection(aliases)
        for alias in aliases
    }
    return ",".join(names)


def cli_input_options(executable: str) -> tuple[str, ...] | None:
    """Input options for an ffmpeg or ffprobe binary; None when its demuxers are unknown."""
    try:
        formats = _cli_formats(executable)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if not formats:
        return None
    return ("-protocol_whitelist", PROTOCOLS, "-format_whitelist", formats)


@functools.cache
def _cli_formats(executable: str) -> str | None:
    completed = subprocess.run(
        [executable, "-hide_banner", "-demuxers"],
        capture_output=True,
        env=subprocess_environment(),
        timeout=10,
        check=False,
    )
    if completed.returncode != 0:
        return None
    rows = completed.stdout.decode("utf-8", "replace").splitlines()
    divider = next((i for i, row in enumerate(rows) if row.strip() == "---"), None)
    if divider is None:
        return None
    # Rows read " D   name   description", with "d" in the flags for a device.
    demuxers = [
        (row[5:].split()[0].split(","), "d" in row[1:4])
        for row in rows[divider + 1 :]
        if row[5:].split() and "D" in row[1:4]
    ]
    return _self_contained(demuxers)


@functools.cache
def pyav_container_options() -> dict[str, str]:
    """Options for av.open. Devices, and anything else that opens no file, are excluded.

    An empty format list is still a list: FFmpeg then refuses every input.
    """
    av = importlib.import_module("av")
    demuxers: list[tuple[list[str], bool]] = []
    for name in sorted(av.formats_available):
        try:
            container_format = av.ContainerFormat(name, "r")
        except ValueError:
            continue
        demuxers.append((container_format.name.split(","), container_format.no_file))
    return {"protocol_whitelist": PROTOCOLS, "format_whitelist": _self_contained(demuxers)}

"""Minimal OS/tool environment for programs which decode untrusted evidence."""

import os

_ALLOWED = {
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "USERPROFILE",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "SYSTEMDRIVE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LANGUAGE",
    "TZ",
    "TESSDATA_PREFIX",
    "FONTCONFIG_PATH",
    "FONTCONFIG_FILE",
    "CUDA_VISIBLE_DEVICES",
    "OMP_NUM_THREADS",
    "HF_HUB_OFFLINE",
    "HF_HUB_DISABLE_TELEMETRY",
    "ORT_DISABLE_TELEMETRY",
}


def subprocess_environment() -> dict[str, str]:
    """Never inherit application tokens, provider configuration, or API keys."""
    return {
        key: value
        for key, value in os.environ.items()
        if key.upper() in _ALLOWED or key.upper().startswith("LC_")
    }

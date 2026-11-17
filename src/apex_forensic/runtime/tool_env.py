"""Environment for external tools that read untrusted evidence."""

import os

# Tools get only what they need to run. Anything else, such as an AI key
# named by api_key_env, stays in the engine process.
_ALLOWED = frozenset(
    {
        "PATH",
        "HOME",
        "TMPDIR",
        "TEMP",
        "TMP",
        "LANG",
        "LANGUAGE",
        "TZ",
        "TESSDATA_PREFIX",
        "OMP_THREAD_LIMIT",
        "OMP_NUM_THREADS",
        "LD_LIBRARY_PATH",
        "DYLD_LIBRARY_PATH",
        "DYLD_FALLBACK_LIBRARY_PATH",
        "SYSTEMROOT",
        "SYSTEMDRIVE",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
        "PROGRAMFILES",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
    }
)


def external_tool_env() -> dict[str, str]:
    """An allowlisted copy of the engine environment for a subprocess."""
    return {
        name: value
        for name, value in os.environ.items()
        if name.upper() in _ALLOWED or name.upper().startswith("LC_")
    }

"""Exclusive engine ownership of its writable directory."""

import sys
from pathlib import Path
from typing import BinaryIO


class DataDirectoryInUseError(RuntimeError):
    """The writable engine directory cannot be acquired exclusively."""


class DataDirectoryLock:
    """A process-lifetime OS lock; keep its inode so competing launches cannot race."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory.resolve()
        self.stream: BinaryIO | None = None

    def __enter__(self) -> "DataDirectoryLock":
        self.directory.mkdir(parents=True, exist_ok=True)
        stream = (self.directory / ".engine.lock").open("a+b")
        try:
            if sys.platform == "win32":
                import msvcrt

                if stream.seek(0, 2) == 0:
                    stream.write(b"\0")
                    stream.flush()
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            stream.close()
            raise DataDirectoryInUseError(
                "APEX data directory is already in use or cannot be locked."
            ) from error
        self.stream = stream
        return self

    def __exit__(self, *_args: object) -> None:
        if self.stream is not None:
            # Closing releases the OS lock, including on process termination.
            self.stream.close()
            self.stream = None

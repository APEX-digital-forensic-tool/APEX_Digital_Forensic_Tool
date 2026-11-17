"""OS-assigned loopback port; readiness contains no credentials."""

import argparse
import json
import os
import socket
import sys
import threading
from pathlib import Path
from typing import IO

import uvicorn

from .app import create_app


def lock_data_dir(data_dir: Path) -> IO[bytes] | None:
    """Hold an exclusive lock on the data folder for the life of the process, or None if taken."""
    data_dir.mkdir(parents=True, exist_ok=True)
    handle = (data_dir / "engine.lock").open("a+b")
    try:
        if sys.platform == "win32":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def exit_on_stdin_eof(server: uvicorn.Server) -> None:
    # The parent keeps stdin open; EOF means it exited or asked for a clean stop.
    for _ in sys.stdin.buffer:
        pass
    server.should_exit = True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--exit-with-parent", action="store_true")
    args = parser.parse_args()
    lock = lock_data_dir(args.data_dir)
    if lock is None:
        print(json.dumps({"type": "apex-error", "code": "DATA_DIR_IN_USE"}), flush=True)
        print("Another APEX engine is already using this data folder.", file=sys.stderr)
        raise SystemExit(3)
    app = create_app(args.data_dir, os.environ.pop("APEX_DESKTOP_TOKEN", ""))
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    server = uvicorn.Server(uvicorn.Config(app, access_log=False, log_level="warning"))
    if args.exit_with_parent:
        threading.Thread(target=exit_on_stdin_eof, args=(server,), daemon=True).start()
    print(json.dumps({"type": "apex-ready", "port": sock.getsockname()[1]}), flush=True)
    server.run(sockets=[sock])
    lock.close()


if __name__ == "__main__":
    main()

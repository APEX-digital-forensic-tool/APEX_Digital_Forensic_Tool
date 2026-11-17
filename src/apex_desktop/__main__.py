"""OS-assigned loopback port; readiness contains no credentials."""

import argparse
import json
import os
import socket
import sys
from pathlib import Path
from threading import Thread, Timer

import uvicorn

from .app import create_app
from .lifecycle import DataDirectoryInUseError, DataDirectoryLock


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--parent-watch", action="store_true")
    args = parser.parse_args()
    try:
        serve(args.data_dir, args.parent_watch)
    except DataDirectoryInUseError:
        print(json.dumps({"type": "apex-start-error", "code": "DATA_DIRECTORY_IN_USE"}), flush=True)
        raise SystemExit(2) from None


def serve(data_dir: Path, parent_watch: bool) -> None:
    """Hold the data lock for the full API and worker lifetime."""
    with DataDirectoryLock(data_dir):
        app = create_app(data_dir, os.environ.pop("APEX_DESKTOP_TOKEN", ""))
        server = uvicorn.Server(uvicorn.Config(app, access_log=False, log_level="warning"))
        if parent_watch:

            def parent_closed() -> None:
                while sys.stdin.buffer.read(1):
                    pass
                server.should_exit = True
                # Native decoders can hang outside cooperative cancellation. Preserve
                # the unfinished receipt for INTERRUPTED recovery, but never orphan forever.
                deadline = Timer(15, lambda: os._exit(1))
                deadline.daemon = True
                deadline.start()

            Thread(target=parent_closed, daemon=True, name="apex-parent-watch").start()
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen(128)
            print(json.dumps({"type": "apex-ready", "port": sock.getsockname()[1]}), flush=True)
            server.run(sockets=[sock])


if __name__ == "__main__":
    main()

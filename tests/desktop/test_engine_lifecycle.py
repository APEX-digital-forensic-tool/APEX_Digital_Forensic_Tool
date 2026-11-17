"""Launch real engine subprocesses: data ownership and parent-EOF shutdown."""

import json
import os
import subprocess
import sys
from pathlib import Path
from queue import Queue
from threading import Thread


def test_second_engine_cannot_touch_live_data_and_parent_eof_releases_lock(tmp_path):
    directory = tmp_path / "data"
    env = dict(os.environ, APEX_DESKTOP_TOKEN="synthetic-test-token-" + "a" * 40)
    command = [sys.executable, "-m", "apex_desktop", "--data-dir", str(directory)]
    first = subprocess.Popen(
        [*command, "--parent-watch"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=env,
        text=True,
    )
    try:
        queue = Queue()
        Thread(target=lambda: queue.put(first.stdout.readline()), daemon=True).start()
        assert json.loads(queue.get(timeout=20))["type"] == "apex-ready"
        database = directory / "apex.db"
        before = database.read_bytes()
        second = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
        assert second.returncode != 0
        assert json.loads(second.stdout)["code"] == "DATA_DIRECTORY_IN_USE"
        assert '"type": "apex-ready"' not in second.stdout
        assert database.read_bytes() == before
        first.stdin.close()
        assert first.wait(timeout=20) == 0
        # The same process-lifetime lock is reusable after the parent closes.
        from apex_desktop.lifecycle import DataDirectoryLock

        with DataDirectoryLock(directory):
            assert Path(directory / "apex.db").exists()
    finally:
        if first.poll() is None:
            first.kill()
            first.wait(timeout=5)

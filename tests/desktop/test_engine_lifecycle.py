"""Engine lifetime: one engine per data folder, exit with the parent, honest shutdown states."""

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from apex_desktop.tasks import Tasks

REPO = Path(__file__).resolve().parents[2]


def _wait(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def test_shutdown_keeps_the_outcome_of_a_running_non_cancellable_task(tmp_path):
    journal = tmp_path / "tasks.json"
    tasks = Tasks(tmp_path / "apex.db", journal)
    release = threading.Event()
    started = threading.Event()

    def register(_services, _token, _progress):
        started.set()
        assert release.wait(10)
        return {"evidence_id": "e1"}

    record = tasks.start("case", "REGISTER", register, cancellable=False)
    assert started.wait(10)
    closing = threading.Thread(target=tasks.close)
    closing.start()
    time.sleep(0.1)
    release.set()
    closing.join(10)

    assert tasks.list("case")[0]["status"] == "SUCCEEDED"
    saved = {r["task_id"]: r for r in json.loads(journal.read_text())}
    assert saved[record["task_id"]]["status"] == "SUCCEEDED"


def test_shutdown_cancels_a_queued_task_before_it_runs(tmp_path):
    tasks = Tasks(tmp_path / "apex.db", tmp_path / "tasks.json")
    release = threading.Event()
    ran: list[str] = []

    def blocker(_services, _token, _progress):
        assert release.wait(10)
        return {}

    tasks.start("case", "OCR", blocker)
    queued = tasks.start("case", "REGISTER", lambda *_: ran.append("register"), cancellable=False)
    closing = threading.Thread(target=tasks.close)
    closing.start()
    time.sleep(0.1)
    release.set()
    closing.join(10)

    statuses = {r["task_id"]: r["status"] for r in tasks.list("case")}
    assert statuses[queued["task_id"]] == "CANCELLED"
    assert ran == []


def _engine(data_dir: Path, *extra: str, stdin=subprocess.DEVNULL) -> subprocess.Popen:
    env = {
        **os.environ,
        "PYTHONPATH": str(REPO / "src"),
        "APEX_DESKTOP_TOKEN": "t" * 48,
    }
    return subprocess.Popen(
        [sys.executable, "-m", "apex_desktop", "--data-dir", str(data_dir), *extra],
        cwd=REPO,
        env=env,
        stdin=stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _ready(process: subprocess.Popen) -> dict:
    line = process.stdout.readline()
    assert line, process.stderr.read()
    message = json.loads(line)
    assert message["type"] == "apex-ready"
    return message


def test_second_engine_on_the_same_data_folder_refuses_to_start(tmp_path):
    first = _engine(tmp_path)
    try:
        _ready(first)
        second = _engine(tmp_path)
        try:
            out, err = second.communicate(timeout=30)
        finally:
            if second.poll() is None:
                second.kill()
                second.wait()
        assert second.returncode != 0
        assert json.loads(out.splitlines()[0]) == {
            "type": "apex-error",
            "code": "DATA_DIR_IN_USE",
        }
        assert "already" in err
        assert first.poll() is None
    finally:
        first.terminate()
        first.wait(30)

    third = _engine(tmp_path)
    try:
        _ready(third)
    finally:
        third.terminate()
        third.wait(30)


def test_engine_exits_when_its_parent_closes_stdin(tmp_path):
    process = _engine(tmp_path, "--exit-with-parent", stdin=subprocess.PIPE)
    try:
        _ready(process)
        time.sleep(0.3)
        assert process.poll() is None
        process.stdin.close()
        assert process.wait(30) == 0
    finally:
        if process.poll() is None:
            process.kill()


def test_engine_without_the_flag_ignores_closed_stdin(tmp_path):
    process = _engine(tmp_path)
    try:
        _ready(process)
        assert not _wait(lambda: process.poll() is not None, timeout=1.5)
    finally:
        process.terminate()
        process.wait(30)

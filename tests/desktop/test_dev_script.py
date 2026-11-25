"""The dev script plans the same steps on every OS and never runs past a failed tool check."""

import importlib.util
import sys
from dataclasses import replace
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "apex_dev", Path(__file__).resolve().parents[2] / "tools/dev.py"
)
assert spec is not None and spec.loader is not None
dev = importlib.util.module_from_spec(spec)
sys.modules["apex_dev"] = dev
spec.loader.exec_module(dev)

READY = dev.Environment(
    platform="darwin",
    python_arch="arm64",
    uv_version="0.13.7",
    node_version="24.21.0",
    node_arch="arm64",
    venv_python=True,
    venv_synced=True,
    node_modules=True,
    npm_current=True,
    assets=True,
    runtime=None,
)


def problems(env):
    return {f.name: f for f in dev.diagnose(env) if not f.ok}


def test_ready_environment_only_notes_the_missing_runtime():
    assert {n: f.severity for n, f in problems(READY).items()} == {"Desktop runtime": "note"}


@pytest.mark.parametrize(
    ("change", "name"),
    [
        ({"uv_version": None}, "uv"),
        ({"node_version": None}, "Node.js"),
        ({"node_version": "22.11.0"}, "Node.js"),
        ({"node_version": "garbage"}, "Node.js"),
        ({"python_arch": "x64"}, "Architecture"),
    ],
)
def test_tool_problems_block_and_say_how_to_fix(change, name):
    finding = problems(replace(READY, **change))[name]
    assert finding.severity == "tool" and finding.fix


def test_wrong_node_version_reports_what_was_found():
    assert "22.11.0" in problems(replace(READY, node_version="22.11.0"))["Node.js"].detail


def test_architecture_is_compared_on_macos_only():
    assert "Architecture" not in problems(replace(READY, platform="win32", python_arch="x64"))


@pytest.mark.parametrize(
    ("change", "name"),
    [
        ({"venv_python": False, "venv_synced": False}, "Python environment"),
        ({"venv_synced": False}, "Python environment"),
        ({"node_modules": False, "npm_current": False}, "Frontend packages"),
        ({"npm_current": False}, "Frontend packages"),
        ({"assets": False}, "Desktop assets"),
    ],
)
def test_stale_state_points_to_setup(change, name):
    finding = problems(replace(READY, **change))[name]
    assert finding.severity == "setup" and "dev setup" in finding.fix


def test_runtime_shows_its_platform_and_architecture():
    env = replace(READY, runtime={"platform": "darwin", "arch": "arm64"})
    runtime = next(f for f in dev.diagnose(env) if f.name == "Desktop runtime")
    assert runtime.ok and "darwin" in runtime.detail and "arm64" in runtime.detail


@pytest.mark.parametrize(
    ("machine", "arch"),
    [("AMD64", "x64"), ("x86_64", "x64"), ("aarch64", "arm64"), ("arm64", "arm64")],
)
def test_normalize_arch(machine, arch):
    assert dev.normalize_arch(machine) == arch


def test_doctor_runs_nothing_and_fails_only_on_real_problems():
    def runner(step):
        raise AssertionError("doctor must not run anything")

    assert dev.main(["doctor"], runner=runner, probe=lambda: READY) == 0
    assert dev.main(["doctor"], runner=runner, probe=lambda: replace(READY, assets=False)) == 1


class Recorder:
    def __init__(self, fail=None):
        self.steps, self.fail = [], fail

    def __call__(self, step):
        self.steps.append(step)
        return 1 if step.name == self.fail else 0


FRESH = replace(
    READY, venv_python=False, venv_synced=False, node_modules=False, npm_current=False, assets=False
)


@pytest.fixture
def frontend(tmp_path, monkeypatch):
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "package-lock.json").write_text('{"lockfileVersion": 3}')
    monkeypatch.setattr(dev, "FRONTEND", tmp_path)
    return tmp_path


def test_setup_syncs_python_prepares_assets_then_installs_packages(frontend):
    rec = Recorder()
    assert dev.main(["setup"], runner=rec, probe=lambda: FRESH) == 0
    assert [s.name for s in rec.steps] == [
        "Sync Python environment",
        "Prepare desktop assets",
        "Install frontend packages",
    ]
    assert rec.steps[0].command == (
        "uv", "sync", "--locked", "--python", "3.12",
        "--extra", "desktop", "--extra", "desktop-build", "--extra", "report-renderer",
        "--extra", "browser-media", "--extra", "windows-artifacts",
        "--extra", "machine-extraction", "--extra", "advanced-secrets",
        "--extra", "dev", "--extra", "backend", "--extra", "mcp-server",
    )  # fmt: skip
    assert rec.steps[1].command == (
        "uv", "run", "--no-sync", "python", "tools/prepare_desktop_assets.py",
    )  # fmt: skip
    assert rec.steps[2].command == ("npm", "ci") and rec.steps[2].cwd == frontend
    assert (frontend / "node_modules" / dev.STAMP_NAME).read_text() == dev.lock_digest()


def test_setup_skips_packages_when_the_lock_is_unchanged(frontend):
    rec = Recorder()
    assert dev.main(["setup"], runner=rec, probe=lambda: READY) == 0
    assert [s.name for s in rec.steps] == ["Sync Python environment", "Prepare desktop assets"]


def test_setup_runs_nothing_when_a_tool_is_missing(frontend):
    rec = Recorder()
    assert dev.main(["setup"], runner=rec, probe=lambda: replace(FRESH, node_version=None)) == 1
    assert rec.steps == []


def test_failed_package_install_is_not_remembered(frontend):
    rec = Recorder(fail="Install frontend packages")
    assert dev.main(["setup"], runner=rec, probe=lambda: FRESH) == 1
    assert not (frontend / "node_modules" / dev.STAMP_NAME).exists()


def test_setup_stops_at_the_first_failure(frontend):
    rec = Recorder(fail="Sync Python environment")
    assert dev.main(["setup"], runner=rec, probe=lambda: FRESH) == 1
    assert [s.name for s in rec.steps] == ["Sync Python environment"]


def test_run_starts_the_dev_app(frontend):
    rec = Recorder()
    assert dev.main(["run"], runner=rec, probe=lambda: READY) == 0
    assert rec.steps == [dev.Step("Start APEX", ("npm", "run", "dev"), frontend)]


@pytest.mark.parametrize("change", [{"venv_python": False}, {"node_modules": False}])
def test_run_refuses_before_setup(frontend, change):
    rec = Recorder()
    assert dev.main(["run"], runner=rec, probe=lambda: replace(READY, **change)) == 1
    assert rec.steps == []


def test_interrupt_ends_quietly_with_130(frontend):
    def runner(step):
        raise KeyboardInterrupt

    assert dev.main(["run"], runner=runner, probe=lambda: READY) == 130


def test_real_runner_works_in_a_path_with_spaces_and_reports_missing_programs(tmp_path):
    folder = tmp_path / "a b"
    folder.mkdir()
    code = "import sys; sys.exit(3)"
    assert dev.run_step(dev.Step("exit 3", (sys.executable, "-c", code), folder)) == 3
    assert dev.run_step(dev.Step("missing", ("apex-no-such-program",), folder)) == 127

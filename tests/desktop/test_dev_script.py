"""The dev script plans the same steps on every OS and never runs past a failed tool check."""

import importlib.util
import re
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


DESKTOP = ["Desktop tests", "Desktop lint", "Desktop types", "Frontend tests"]
ENGINE = ["Engine tests"]
SERVER = [
    "MCP tests",
    "Backend tests",
    "Server lint",
    "Server types",
    "MCP stdio smoke",
    "MCP release gate",
]


def test_check_runs_everything_even_after_a_failure(frontend):
    rec = Recorder(fail="Desktop tests")
    assert dev.main(["check"], runner=rec, probe=lambda: READY) == 1
    assert [s.name for s in rec.steps] == DESKTOP + ENGINE + SERVER


def test_check_passes_when_every_step_passes(frontend):
    assert dev.main(["check"], runner=Recorder(), probe=lambda: READY) == 0


@pytest.mark.parametrize(
    ("groups", "names"),
    [
        (["desktop"], DESKTOP),
        (["engine"], ENGINE),
        (["server"], SERVER),
        (["desktop", "engine"], DESKTOP + ENGINE),
        (["engine", "desktop", "engine"], ENGINE + DESKTOP),
    ],
)
def test_check_runs_the_named_groups_once_in_the_given_order(frontend, groups, names):
    rec = Recorder()
    assert dev.main(["check", *groups], runner=rec, probe=lambda: READY) == 0
    assert [s.name for s in rec.steps] == names


def test_engine_group_runs_the_unit_and_integration_suites():
    (step,) = dev.check_steps(["engine"])
    assert step.command == ("uv", "run", "--no-sync", "pytest", "tests/unit", "tests/integration")


def test_check_rejects_an_unknown_group(frontend, capsys):
    with pytest.raises(SystemExit) as exit_info:
        dev.main(["check", "desktop", "everything"], runner=Recorder(), probe=lambda: READY)
    assert exit_info.value.code == 2
    assert "desktop, engine, server" in capsys.readouterr().err


WORKFLOWS = Path(__file__).resolve().parents[2] / ".github/workflows"


def workflow_commands(name):
    lines = (WORKFLOWS / name).read_text(encoding="utf-8").splitlines()
    return {line.strip().removeprefix("- ").removeprefix("run: ") for line in lines}


# The desktop workflows call this script, so its lists are the only copy. These tests keep
# a second copy from growing back, and keep the script's own files in the path filter.
DIRECT = (
    "uv sync",
    "uv run --no-sync pytest",
    "uv run --no-sync ruff",
    "uv run --no-sync mypy",
    "uv run --no-sync python tools/build_desktop_runtime.py",
    "npm ci",
    "npm test",
)


@pytest.mark.parametrize(
    "name",
    ["desktop-build.yml", "desktop-ci.yml", "desktop-preview-release.yml", "desktop-release.yml"],
)
def test_desktop_workflows_leave_the_commands_to_the_dev_script(name):
    assert [c for c in workflow_commands(name) if c.startswith(DIRECT)] == []


def test_the_shared_workflow_calls_the_dev_script():
    assert {
        "./dev setup",
        "./dev check ${{ matrix.groups }}",
        "./dev build runtime",
        "./dev build installer",
    } <= workflow_commands("desktop-build.yml")


def test_dev_script_changes_trigger_the_desktop_check():
    text = (WORKFLOWS / "desktop-ci.yml").read_text(encoding="utf-8")
    for path in (
        "'tools/dev.py'",
        "'dev'",
        "'dev.cmd'",
        "'tests/unit/**'",
        "'tests/integration/**'",
        "'.github/workflows/desktop-build.yml'",
    ):
        assert text.count(path) == 2, path  # once for pull_request, once for push


# mcp-ci.yml still keeps its own copy of the server commands.
def test_server_checks_are_the_commands_the_mcp_workflow_runs():
    ci = workflow_commands("mcp-ci.yml")
    for step in dev.check_steps(["server"]):
        command = " ".join(step.command).replace("uv run --no-sync", "uv run --locked")
        assert command in ci, step.name


def test_setup_installs_every_extra_the_mcp_workflow_installs():
    extras = set()
    for command in workflow_commands("mcp-ci.yml"):
        if command.startswith("uv sync"):
            words = command.split()
            extras.update(words[i + 1] for i, word in enumerate(words) if word == "--extra")
    assert extras and extras <= set(dev.EXTRAS)


def test_build_steps_follow_the_platform(frontend):
    mac = dev.build_steps("darwin")
    assert [s.name for s in mac] == [
        "Build engine runtime",
        "Verify engine runtime",
        "Package installer",
        "Verify macOS preview",
    ]
    assert mac[2] == dev.Step("Package installer", ("npm", "run", "dist:mac"), frontend, attempts=3)
    windows = dev.build_steps("win32")
    assert [s.name for s in windows] == [
        "Build engine runtime",
        "Verify engine runtime",
        "Package installer",
    ]
    assert windows[2].command == ("npm", "run", "dist:win")


def test_build_stops_at_the_first_failure(frontend):
    rec = Recorder(fail="Verify engine runtime")
    assert dev.main(["build"], runner=rec, probe=lambda: READY) == 1
    assert [s.name for s in rec.steps] == ["Build engine runtime", "Verify engine runtime"]


def test_build_refuses_other_platforms(frontend):
    rec = Recorder()
    assert dev.main(["build"], runner=rec, probe=lambda: replace(READY, platform="linux")) == 1
    assert rec.steps == []


BUILT = replace(READY, runtime={"platform": "darwin", "arch": "arm64"})


@pytest.mark.parametrize(
    ("part", "names"),
    [
        ("runtime", ["Build engine runtime", "Verify engine runtime"]),
        ("installer", ["Package installer", "Verify macOS preview"]),
    ],
)
def test_build_can_run_one_part(frontend, part, names):
    rec = Recorder()
    assert dev.main(["build", part], runner=rec, probe=lambda: BUILT) == 0
    assert [s.name for s in rec.steps] == names


@pytest.mark.parametrize(
    "runtime", [None, {"platform": "win32", "arch": "x64"}, {"platform": "darwin", "arch": "x64"}]
)
def test_installer_alone_needs_a_runtime_for_this_machine(frontend, capsys, runtime):
    rec = Recorder()
    env = replace(READY, runtime=runtime)
    assert dev.main(["build", "installer"], runner=rec, probe=lambda: env) == 1
    assert rec.steps == []
    assert "./dev build runtime" in capsys.readouterr().out


def test_windows_installer_part_has_no_macos_verification(frontend):
    assert [s.name for s in dev.build_steps("win32", ["installer"])] == ["Package installer"]


class Flaky:
    """Fails each named step a fixed number of times, then succeeds."""

    def __init__(self, failures):
        self.failures, self.calls = dict(failures), []

    def __call__(self, step):
        self.calls.append(step.name)
        left = self.failures.get(step.name, 0)
        self.failures[step.name] = left - 1
        return 7 if left > 0 else 0


@pytest.fixture
def no_delay(monkeypatch):
    monkeypatch.setattr(dev, "RETRY_DELAY", 0)


def test_only_the_download_steps_are_retried(frontend):
    attempts = {s.name: s.attempts for s in dev.build_steps("darwin")}
    assert attempts == {
        "Build engine runtime": 3,
        "Verify engine runtime": 1,
        "Package installer": 3,
        "Verify macOS preview": 1,
    }
    assert all(s.attempts == 1 for s in dev.check_steps(list(dev.GROUPS)))
    assert all(s.attempts == 1 for s in dev.setup_steps(npm_current=False))


def test_a_step_that_recovers_is_retried_and_the_build_goes_on(frontend, no_delay, capsys):
    runner = Flaky({"Build engine runtime": 2})
    assert dev.main(["build", "runtime"], runner=runner, probe=lambda: READY) == 0
    assert runner.calls == ["Build engine runtime"] * 3 + ["Verify engine runtime"]
    assert "Attempt 2 of 3 failed" in capsys.readouterr().out


def test_a_step_that_keeps_failing_stops_the_build_with_its_exit_code(frontend, no_delay):
    runner = Flaky({"Build engine runtime": 9})
    assert dev.main(["build"], runner=runner, probe=lambda: READY) == 7
    assert runner.calls == ["Build engine runtime"] * 3


def test_interrupt_while_waiting_to_retry_ends_with_130(frontend, monkeypatch):
    def interrupted(_seconds):
        raise KeyboardInterrupt

    monkeypatch.setattr(dev.time, "sleep", interrupted)
    runner = Flaky({"Build engine runtime": 9})
    assert dev.main(["build"], runner=runner, probe=lambda: READY) == 130
    assert runner.calls == ["Build engine runtime"]


def test_summaries_show_how_long_each_step_took(frontend, capsys):
    assert dev.main(["check", "engine"], runner=Recorder(), probe=lambda: READY) == 0
    assert re.search(r"^PASS  Engine tests  \d+s$", capsys.readouterr().out, re.M)
    failing = Recorder(fail="Verify engine runtime")
    assert dev.main(["build", "runtime"], runner=failing, probe=lambda: READY) == 1
    out = capsys.readouterr().out
    assert re.search(r"^PASS  Build engine runtime  \d+s$", out, re.M)
    assert re.search(r"^FAIL  Verify engine runtime  \d+s$", out, re.M)


def test_every_step_has_an_absolute_working_directory():
    steps = (
        dev.setup_steps(npm_current=False)
        + dev.build_steps("darwin")
        + dev.build_steps("win32")
        + dev.check_steps(["desktop", "engine", "server"])
    )
    assert all(step.cwd.is_absolute() for step in steps)


def test_children_get_the_utf8_mode_ci_uses(tmp_path, monkeypatch):
    monkeypatch.delenv("PYTHONUTF8", raising=False)
    code = "import sys; sys.exit(0 if sys.flags.utf8_mode else 4)"
    assert dev.run_step(dev.Step("utf8", (sys.executable, "-c", code), tmp_path)) == 0


def test_probe_commands_survive_undecodable_output():
    code = "import sys; sys.stdout.buffer.write(b'ok \\xff'); sys.stderr.buffer.write(b'\\xff')"
    assert dev._output((sys.executable, "-c", code)).startswith("ok")


@pytest.mark.parametrize("command", ["run", "check", "build"])
def test_a_stale_environment_is_announced_but_does_not_block(frontend, capsys, command):
    rec = Recorder()
    stale = replace(READY, venv_synced=False)
    assert dev.main([command], runner=rec, probe=lambda: stale) == 0
    assert rec.steps
    out = capsys.readouterr().out
    assert "Python environment" in out and "dev setup" in out


def test_a_current_environment_is_not_announced(frontend, capsys):
    assert dev.main(["check", "desktop"], runner=Recorder(), probe=lambda: READY) == 0
    assert "[fix]" not in capsys.readouterr().out

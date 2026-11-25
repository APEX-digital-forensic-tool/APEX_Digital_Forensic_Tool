"""Set up, run, build, and check APEX from source with one command.

Start it through the launchers in the repository root: ``./dev`` on macOS, ``.\\dev`` on
Windows. Standard library only, because it has to work before the project environment exists.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
PYTHON_VERSION = "3.12"
NODE_MAJOR = 24
# One environment for desktop, server, and development work: `uv sync` removes whatever
# is not listed, so a narrower list would uninstall the other side's packages.
EXTRAS = (
    "desktop",
    "desktop-build",
    "report-renderer",
    "browser-media",
    "windows-artifacts",
    "machine-extraction",
    "advanced-secrets",
    "dev",
    "backend",
    "mcp-server",
)
SYNC = (
    "uv",
    "sync",
    "--locked",
    "--python",
    PYTHON_VERSION,
    *(argument for extra in EXTRAS for argument in ("--extra", extra)),
)
STAMP_NAME = ".apex-lock-sha256"

SYNC_PYTHON = "Sync Python environment"
PREPARE_ASSETS = "Prepare desktop assets"
INSTALL_PACKAGES = "Install frontend packages"
START_APP = "Start APEX"

UV_HINT = (
    "Install uv: https://docs.astral.sh/uv/getting-started/installation/ "
    "(macOS: brew install uv, Windows: winget install --id=astral-sh.uv -e)"
)
NODE_HINT = (
    "Install Node.js 24: https://nodejs.org/en/download "
    "(or with your version manager: nvm install 24, fnm install 24)"
)
ARCH_HINT = "Use Python and Node.js of the same architecture (Apple Silicon: arm64, Intel: x64)."
RUNTIME_HINT = "Only needed for installers; ./dev build creates it."


@dataclass(frozen=True)
class Environment:
    """What the machine and this checkout look like right now."""

    platform: str
    python_arch: str
    uv_version: str | None
    node_version: str | None
    node_arch: str | None
    venv_python: bool
    venv_synced: bool
    node_modules: bool
    npm_current: bool
    assets: bool
    runtime: dict[str, str] | None


@dataclass(frozen=True)
class Finding:
    """One checked item. severity: "tool" blocks everything, "setup" is fixed by setup."""

    name: str
    ok: bool
    detail: str
    fix: str
    severity: str


@dataclass(frozen=True)
class Step:
    name: str
    command: tuple[str, ...]
    cwd: Path


Runner = Callable[[Step], int]


def normalize_arch(machine: str) -> str:
    name = machine.lower()
    return {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64"}.get(name, name)


def lock_digest() -> str:
    return hashlib.sha256((FRONTEND / "package-lock.json").read_bytes()).hexdigest()


def _output(command: Sequence[str]) -> str | None:
    """Standard output of a command that succeeded, else None."""
    program = shutil.which(command[0])
    if program is None:
        return None
    try:
        result = subprocess.run(
            [program, *command[1:]], cwd=ROOT, capture_output=True, text=True, check=False
        )
    except OSError:
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _runtime() -> dict[str, str] | None:
    try:
        info = json.loads((ROOT / "desktop-runtime" / "runtime-info.json").read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return {str(key): str(value) for key, value in info.items()} if isinstance(info, dict) else None


def probe() -> Environment:
    uv = (_output(("uv", "--version")) or "").split()
    node = _output(("node", "--version"))
    interpreter = "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
    venv_python = (ROOT / ".venv" / interpreter).is_file()
    modules = FRONTEND / "node_modules"
    return Environment(
        platform=sys.platform,
        python_arch=normalize_arch(platform.machine()),
        uv_version=(uv[1] if len(uv) > 1 else uv[0]) if uv else None,
        node_version=node.removeprefix("v") if node else None,
        node_arch=_output(("node", "-p", "process.arch")) or None,
        venv_python=venv_python,
        venv_synced=venv_python and _output((*SYNC, "--check")) is not None,
        node_modules=modules.is_dir(),
        npm_current=modules.is_dir() and _read(modules / STAMP_NAME) == lock_digest(),
        assets=(ROOT / "desktop-assets").is_dir(),
        runtime=_runtime(),
    )


def _finding(name: str, ok: bool, detail: str, fix: str, severity: str) -> Finding:
    return Finding(name, ok, detail, "" if ok else fix, severity)


def _node(env: Environment) -> Finding:
    version = env.node_version
    if version is None:
        return _finding("Node.js", False, "not found", NODE_HINT, "tool")
    major = version.split(".")[0]
    if major.isdigit() and int(major) == NODE_MAJOR:
        return _finding("Node.js", True, version, NODE_HINT, "tool")
    return _finding("Node.js", False, f"found {version}, need {NODE_MAJOR}.x", NODE_HINT, "tool")


def _launcher(platform_name: str) -> str:
    return ".\\dev" if platform_name == "win32" else "./dev"


def diagnose(env: Environment) -> list[Finding]:
    setup = f"Run {_launcher(env.platform)} setup"
    findings = [
        _finding("uv", env.uv_version is not None, env.uv_version or "not found", UV_HINT, "tool"),
        _node(env),
    ]
    if env.platform == "darwin" and env.node_arch:
        findings.append(
            _finding(
                "Architecture",
                env.python_arch == env.node_arch,
                f"Python {env.python_arch}, Node.js {env.node_arch}",
                ARCH_HINT,
                "tool",
            )
        )
    if not env.venv_python:
        python = "missing"
    elif not env.venv_synced:
        python = "out of date with uv.lock"
    else:
        python = f"Python {PYTHON_VERSION}, matches uv.lock"
    if not env.node_modules:
        packages = "missing"
    elif not env.npm_current:
        packages = "package-lock.json changed since the last dev setup"
    else:
        packages = "match package-lock.json"
    assets = "present" if env.assets else "missing"
    runtime = env.runtime
    built = f"{runtime.get('platform', '?')} {runtime.get('arch', '?')}" if runtime else "not built"
    python_ok = env.venv_python and env.venv_synced
    packages_ok = env.node_modules and env.npm_current
    findings += [
        _finding("Python environment", python_ok, python, setup, "setup"),
        _finding("Frontend packages", packages_ok, packages, setup, "setup"),
        _finding("Desktop assets", env.assets, assets, setup, "setup"),
        _finding("Desktop runtime", runtime is not None, built, RUNTIME_HINT, "note"),
    ]
    return findings


def report(findings: Sequence[Finding]) -> None:
    for finding in findings:
        tag = "ok" if finding.ok else ("note" if finding.severity == "note" else "fix")
        print(f"[{tag}] {finding.name}: {finding.detail}")
        if not finding.ok:
            print(f"      {finding.fix}")


def run_step(step: Step) -> int:
    print(f"==> {step.name}", flush=True)
    print("    " + " ".join(step.command), flush=True)
    program = shutil.which(step.command[0])
    if program is None:
        print(f"{step.command[0]} was not found on PATH", file=sys.stderr)
        return 127
    process = subprocess.Popen([program, *step.command[1:]], cwd=step.cwd)
    try:
        return process.wait()
    except KeyboardInterrupt:
        # The child received the same Ctrl-C from the terminal: let it shut down by itself
        # instead of killing it, so the app can stop its analysis engine.
        process.wait()
        raise


def run_steps(
    steps: Sequence[Step], runner: Runner, *, keep_going: bool = False
) -> list[tuple[Step, int]]:
    results = []
    for step in steps:
        code = runner(step)
        results.append((step, code))
        if code != 0 and not keep_going:
            break
    return results


def setup_steps(*, npm_current: bool) -> list[Step]:
    prepare = ("uv", "run", "--no-sync", "python", "tools/prepare_desktop_assets.py")
    steps = [Step(SYNC_PYTHON, SYNC, ROOT), Step(PREPARE_ASSETS, prepare, ROOT)]
    if not npm_current:
        steps.append(Step(INSTALL_PACKAGES, ("npm", "ci"), FRONTEND))
    return steps


def _setup(env: Environment, runner: Runner) -> int:
    results = run_steps(setup_steps(npm_current=env.npm_current), runner)
    for step, code in results:
        if step.name == INSTALL_PACKAGES and code == 0:
            # Written only after a finished install, so an interrupted one is repeated.
            (FRONTEND / "node_modules" / STAMP_NAME).write_text(lock_digest(), encoding="utf-8")
    code = results[-1][1]
    if code == 0:
        print(f"Next: {_launcher(env.platform)} run")
    return code


def _dispatch(command: str, env: Environment, runner: Runner) -> int:
    findings = diagnose(env)
    if command == "doctor":
        report(findings)
        return 1 if any(not f.ok and f.severity != "note" for f in findings) else 0
    blockers = [f for f in findings if not f.ok and f.severity == "tool"]
    if blockers:
        report(blockers)
        return 1
    if command == "setup":
        return _setup(env, runner)
    if not (env.venv_python and env.node_modules):
        print(f"Run {_launcher(env.platform)} setup first.")
        return 1
    return runner(Step(START_APP, ("npm", "run", "dev"), FRONTEND))


def main(
    argv: Sequence[str] | None = None,
    *,
    runner: Runner = run_step,
    probe: Callable[[], Environment] = probe,
) -> int:
    parser = argparse.ArgumentParser(prog="dev", description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("setup", help="install everything needed to develop APEX")
    commands.add_parser("run", help="start the desktop app from source")
    commands.add_parser("doctor", help="show what is installed and what is missing")
    args = parser.parse_args(argv)
    try:
        return _dispatch(args.command, probe(), runner)
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())

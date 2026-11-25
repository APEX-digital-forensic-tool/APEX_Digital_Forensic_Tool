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


def diagnose(env: Environment) -> list[Finding]:
    setup = "Run .\\dev setup" if env.platform == "win32" else "Run ./dev setup"
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
    raise NotImplementedError


def main(
    argv: Sequence[str] | None = None,
    *,
    runner: Runner = run_step,
    probe: Callable[[], Environment] = probe,
) -> int:
    parser = argparse.ArgumentParser(prog="dev", description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor", help="show what is installed and what is missing")
    parser.parse_args(argv)
    findings = diagnose(probe())
    report(findings)
    return 1 if any(not f.ok and f.severity != "note" for f in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())

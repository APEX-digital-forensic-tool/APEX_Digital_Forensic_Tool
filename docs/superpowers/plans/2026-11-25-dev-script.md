# 개발 설치·빌드 스크립트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장소 루트의 `./dev`(Windows는 `.\dev`) 한 명령으로 개발 환경 설치, 앱 실행, 설치 파일 빌드, CI와 같은 검사를 하게 한다.

**Architecture:** 모든 로직은 표준 라이브러리만 쓰는 `tools/dev.py`에 둔다. 환경을 읽는 부분(`probe`), 판단(`diagnose`), 실행할 명령 목록(`*_steps`)을 나누고, 명령 실행기(`Runner`)를 주입받아 단위 테스트에서 가짜로 바꾼다. 루트의 `dev`와 `dev.cmd`는 uv가 있는지만 보고 `tools/dev.py`를 부른다.

**Tech Stack:** Python 3.12 표준 라이브러리(`argparse`, `subprocess`, `dataclasses`), uv, POSIX sh, Windows cmd, pytest.

**Spec:** `docs/superpowers/specs/2026-11-25-dev-script-design.md`

## Global Constraints

- 브랜치 `feat/dev-script`. `main`은 직접 푸시할 수 없고 PR로만 들어간다.
- 커밋·PR 본문에 Claude 관련 문구(Co-Authored-By, Generated with)를 넣지 않는다.
- `tools/dev.py`는 표준 라이브러리만 import한다. 프로젝트 환경이 없을 때도 돌아야 한다.
- 스크립트가 출력하는 글은 영어. 문서는 한국어.
- 고정값: `PYTHON_VERSION = "3.12"`, `NODE_MAJOR = 24`, extra 열 개와 순서 `desktop`, `desktop-build`, `report-renderer`, `browser-media`, `windows-artifacts`, `machine-extraction`, `advanced-secrets`, `dev`, `backend`, `mcp-server`.
- 명령은 인자 목록으로 실행한다. `shell=True`와 문자열 명령을 쓰지 않는다.
- 워크플로(`.github/workflows/*`), `tools/build_desktop_runtime.ps1`, `tools/run_gui_ai.ps1`은 건드리지 않는다.
- 각 태스크 완료 조건: `uv run --no-sync pytest tests/desktop/test_dev_script.py`와 `uv run --no-sync ruff check tools/dev.py tests/desktop/test_dev_script.py` 통과.
- uv와 Node는 스크립트가 설치하지 않는다. 안내만 한다.

## Review Focus

1. **다른 폴더에서 실행** — `frontend/`나 저장소 밖에서 불러도 같은 결과여야 한다 → Task 3(모든 단계의 작업 폴더가 절대 경로), Task 4(다른 폴더에서 `doctor` 실행).
2. **공백이 있는 경로** — Windows 사용자 폴더처럼 경로에 공백이 있어도 돌아야 한다 → Task 2(공백 있는 폴더에서 실제 실행기 테스트), Task 5(공백 있는 폴더에 새로 받아 실행).
3. **실행 중 Ctrl-C** — `run` 도중 Ctrl-C를 눌러도 Python 오류 출력 없이 끝나고 분석 엔진 프로세스가 남지 않아야 한다 → Task 2(130 반환 테스트), Task 5(실제 확인).
4. **Node가 없거나 다른 버전이거나 버전 출력이 이상할 때, 실행 파일이 PATH에 없을 때** — 오류로 죽지 않고 무엇을 찾았는지와 고치는 방법을 보여 준다 → Task 1(`diagnose`), Task 2(127 반환).
5. **`npm ci`가 실패하거나 중간에 끊긴 뒤 다시 실행** — 설치된 것으로 착각해 건너뛰면 안 된다 → Task 2(실패 시 표시 파일을 쓰지 않음).

---

## File Structure

- `tools/dev.py` — 생성. 환경 읽기, 판단, 단계 목록, 실행기, 명령 다섯 개.
- `tests/desktop/test_dev_script.py` — 생성. 가짜 실행기와 가짜 환경으로 로직을 확인한다. `tests/desktop`에 있어 기존 CI가 세 OS에서 돌리고 ruff도 검사한다.
- `dev`, `dev.cmd` — 생성. 얇은 실행 파일.
- `.gitattributes` — 수정. 줄바꿈 고정.
- `docs/desktop/README.md`, `frontend/README.md` — 수정. 명령 블록을 `./dev`로 바꾼다.

### Task 1: 환경 점검과 `doctor`

**Files:**
- Create: `tools/dev.py`
- Test: `tests/desktop/test_dev_script.py`

**Interfaces:**
- Produces:
  - `ROOT: Path`(저장소 루트), `FRONTEND: Path`(`ROOT / "frontend"`). 함수들은 호출 시점에 이 전역을 읽는다(테스트가 monkeypatch한다).
  - `PYTHON_VERSION`, `NODE_MAJOR`, `EXTRAS: tuple[str, ...]`, `SYNC: tuple[str, ...]` = `("uv", "sync", "--locked", "--python", "3.12", "--extra", "desktop", …)` (extra 열 개).
  - `STAMP_NAME = ".apex-lock-sha256"`, `lock_digest() -> str` — `FRONTEND / "package-lock.json"`의 SHA-256 16진 문자열.
  - `@dataclass(frozen=True) class Environment` — 필드: `platform: str`, `python_arch: str`, `uv_version: str | None`, `node_version: str | None`(앞의 `v` 제거), `node_arch: str | None`, `venv_python: bool`, `venv_synced: bool`, `node_modules: bool`, `npm_current: bool`, `assets: bool`, `runtime: dict[str, str] | None`.
  - `@dataclass(frozen=True) class Finding` — `name: str`, `ok: bool`, `detail: str`, `fix: str`, `severity: str`(`"tool"` | `"setup"` | `"note"`).
  - `normalize_arch(machine: str) -> str`, `probe() -> Environment`, `diagnose(env: Environment) -> list[Finding]`, `report(findings: Sequence[Finding]) -> None`.
  - `main(argv: Sequence[str] | None = None, *, runner: Runner = run_step, probe: Callable[[], Environment] = probe) -> int`. 이 태스크에서는 `doctor`만 구현하고 `Runner`/`run_step`은 Task 2에서 채운다(자리만 둔다).

- [ ] **Step 1: 브랜치를 만들고 설계·계획 문서를 커밋한다**

```bash
git switch -c feat/dev-script
git add docs/superpowers/specs/2026-11-25-dev-script-design.md docs/superpowers/plans/2026-11-25-dev-script.md
git commit -m "docs: add dev script design and plan"
```

- [ ] **Step 2: 이슈를 만들고 진행 중으로 표시한다**

제목 `개발 설치·빌드 스크립트 (./dev)`, 라벨 `enhancement`와 `in progress`, 담당자 `@me`. 본문은 설계 문서의 목적과 성공 기준 세 줄. 만든 뒤 브랜치 이름을 댓글로 남긴다. 이슈 번호를 Task 5의 PR 본문에 쓴다.

- [ ] **Step 3: 실패하는 테스트를 쓴다**

파일 머리(그대로 쓴다. `sys.modules` 등록이 없으면 dataclass 정의에서 실패한다):

```python
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
    platform="darwin", python_arch="arm64", uv_version="0.13.7",
    node_version="24.21.0", node_arch="arm64",
    venv_python=True, venv_synced=True, node_modules=True, npm_current=True,
    assets=True, runtime=None,
)


def problems(env):
    return {f.name: f for f in dev.diagnose(env) if not f.ok}
```

테스트:

```python
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
```

- [ ] **Step 4: 테스트가 실패하는지 확인한다**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py`
Expected: FAIL — `tools/dev.py`가 없어 수집 단계에서 오류.

- [ ] **Step 5: `tools/dev.py`에 위 Interfaces를 구현한다**

- `probe()`가 읽는 것:
  - `uv --version` → `"uv 0.13.7 (…)"`의 둘째 단어. `node --version` → `v` 제거. `node -p process.arch`. 실행 파일이 없거나 실패하면 `None`.
  - `venv_python`: `ROOT/.venv/Scripts/python.exe`(win32) 또는 `ROOT/.venv/bin/python`이 있는지.
  - `venv_synced`: `venv_python`이고 `SYNC + ("--check",)`의 종료 코드가 0(출력은 버린다).
  - `node_modules`: `FRONTEND/node_modules`가 폴더인지. `npm_current`: `node_modules`이고 `FRONTEND/node_modules/.apex-lock-sha256`의 내용이 `lock_digest()`와 같은지.
  - `assets`: `ROOT/desktop-assets`가 폴더인지. `runtime`: `ROOT/desktop-runtime/runtime-info.json`을 읽은 dict, 없거나 깨졌으면 `None`.
- `diagnose()`의 항목 이름과 순서: `uv`, `Node.js`, `Architecture`(darwin이고 두 값이 모두 있을 때만 비교), `Python environment`, `Frontend packages`, `Desktop assets`, `Desktop runtime`.
- 안내 문구(그대로):
  - uv: `Install uv: https://docs.astral.sh/uv/getting-started/installation/ (macOS: brew install uv, Windows: winget install --id=astral-sh.uv -e)`
  - Node.js: `Install Node.js 24: https://nodejs.org/en/download (or with your version manager: nvm install 24, fnm install 24)`
  - Architecture: `Use Python and Node.js of the same architecture (Apple Silicon: arm64, Intel: x64).`
  - setup 항목: win32는 `Run .\dev setup`, 그 밖은 `Run ./dev setup`
  - Desktop runtime 없음: `Only needed for installers; ./dev build creates it.`
- `report()`는 항목마다 한 줄(`[ok]`, `[fix]`, `[note]` + 이름 + detail), 문제가 있는 항목은 다음 줄에 fix를 들여써서 출력한다.
- `main`의 `doctor`: `report(diagnose(probe()))` 뒤, ok가 아닌 `tool`/`setup` 항목이 있으면 1, 없으면 0. 하위 명령은 `argparse` 서브파서로 받고 `prog="dev"`.
- 파일 끝: `if __name__ == "__main__": raise SystemExit(main())`.

- [ ] **Step 6: 테스트와 린트가 통과하는지 확인한다**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py && uv run --no-sync ruff check tools/dev.py tests/desktop/test_dev_script.py`
Expected: PASS, `All checks passed!`

- [ ] **Step 7: 실제 환경에서 `doctor`를 돌려 본다**

Run: `uv run --no-project --python 3.12 tools/dev.py doctor`
Expected: 항목 일곱 개가 출력된다. 이 체크아웃은 `Python environment`와 `Frontend packages`가 `[fix]`로 나올 수 있다(패키지 설치 형태가 다르고 표시 파일이 아직 없다). 오류 출력(traceback)은 없어야 한다.

- [ ] **Step 8: 커밋**

```bash
git add tools/dev.py tests/desktop/test_dev_script.py
git commit -m "feat(tools): add dev doctor environment check"
```

### Task 2: `setup`과 `run`

**Files:**
- Modify: `tools/dev.py`
- Test: `tests/desktop/test_dev_script.py`

**Interfaces:**
- Consumes: Task 1의 `Environment`, `diagnose`, `report`, `SYNC`, `lock_digest`, `STAMP_NAME`, `ROOT`, `FRONTEND`.
- Produces:
  - `@dataclass(frozen=True) class Step` — `name: str`, `command: tuple[str, ...]`, `cwd: Path`.
  - `Runner = Callable[[Step], int]`, `run_step(step: Step) -> int`.
  - `run_steps(steps: Sequence[Step], runner: Runner, *, keep_going: bool = False) -> list[tuple[Step, int]]` — `keep_going`이 아니면 0이 아닌 첫 결과에서 멈춘다.
  - `setup_steps(*, npm_current: bool) -> list[Step]`.
  - 단계 이름 상수: `"Sync Python environment"`, `"Prepare desktop assets"`, `"Install frontend packages"`, `"Start APEX"`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
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
        "Sync Python environment", "Prepare desktop assets", "Install frontend packages",
    ]
    assert rec.steps[0].command == (
        "uv", "sync", "--locked", "--python", "3.12",
        "--extra", "desktop", "--extra", "desktop-build", "--extra", "report-renderer",
        "--extra", "browser-media", "--extra", "windows-artifacts",
        "--extra", "machine-extraction", "--extra", "advanced-secrets",
        "--extra", "dev", "--extra", "backend", "--extra", "mcp-server",
    )
    assert rec.steps[1].command == (
        "uv", "run", "--no-sync", "python", "tools/prepare_desktop_assets.py",
    )
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
```

- [ ] **Step 2: 실패하는지 확인한다**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py`
Expected: FAIL — `Step`, `setup` 명령이 없다.

- [ ] **Step 3: 구현한다**

- `run_step`: `==> <이름>`과 명령 줄을 출력한다. `shutil.which(step.command[0])`로 실행 파일을 찾고(Windows의 `npm.cmd`가 이 방법으로 풀린다), 없으면 `<이름> was not found on PATH`를 출력하고 127을 반환한다. `subprocess.Popen`으로 실행하고 종료 코드를 반환한다. 기다리는 중 `KeyboardInterrupt`가 오면 자식을 죽이지 말고(자식도 터미널에서 같은 신호를 받는다) 끝날 때까지 기다린 뒤 `KeyboardInterrupt`를 다시 올린다.
- `setup_steps`: `Step("Sync Python environment", SYNC, ROOT)`, `Step("Prepare desktop assets", ("uv", "run", "--no-sync", "python", "tools/prepare_desktop_assets.py"), ROOT)`, `npm_current`가 아니면 `Step("Install frontend packages", ("npm", "ci"), FRONTEND)`.
- `main`의 `setup`: ok가 아닌 `tool` 항목이 있으면 그것만 `report`하고 1. 단계를 돌려 실패하면 그 종료 코드. `Install frontend packages`가 0으로 끝났을 때만 `FRONTEND/node_modules/.apex-lock-sha256`에 `lock_digest()`를 쓴다. 끝에 `Next: ./dev run`(win32는 `.\dev run`)을 출력하고 0.
- `main`의 `run`: `tool` 문제가 있으면 위와 같이 1. `venv_python`이나 `node_modules`가 False면 `Run ./dev setup first.`를 출력하고 1. 아니면 `runner(Step("Start APEX", ("npm", "run", "dev"), FRONTEND))`의 결과를 반환한다.
- `main` 전체: 명령 실행 중의 `KeyboardInterrupt`를 잡아 `Interrupted.`를 출력하고 130을 반환한다.

- [ ] **Step 4: 통과하는지 확인한다**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py && uv run --no-sync ruff check tools/dev.py tests/desktop/test_dev_script.py`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add tools/dev.py tests/desktop/test_dev_script.py
git commit -m "feat(tools): add dev setup and run"
```

### Task 3: `check`와 `build`

**Files:**
- Modify: `tools/dev.py`
- Test: `tests/desktop/test_dev_script.py`

**Interfaces:**
- Consumes: Task 2의 `Step`, `run_steps`, `Recorder`와 `frontend` 픽스처.
- Produces: `check_steps(groups: Sequence[str]) -> list[Step]`(`groups`는 `"desktop"`, `"server"`), `build_steps(platform: str) -> list[Step]`(`darwin`, `win32` 외에는 `ValueError`).

검사 목록은 `desktop-ci.yml`과 `mcp-ci.yml`에서 그대로 옮긴다. 모든 Python 명령 앞에는 `("uv", "run", "--no-sync")`가 붙는다.

| 그룹 | 단계 이름 | 명령 (접두어 뒤) | 작업 폴더 |
|---|---|---|---|
| desktop | `Desktop tests` | `pytest tests/desktop tests/unit/test_container_workflows.py tests/unit/test_advanced_runtime_decryption.py tests/unit/test_logical_content_integrity.py tests/unit/test_image_source_identity.py tests/unit/test_file_system_indexing.py` | ROOT |
| desktop | `Desktop lint` | `ruff check src/apex_desktop tests/desktop tools/build_desktop_runtime.py tools/prepare_desktop_assets.py tools/verify_desktop_runtime.py tools/verify_macos_release.py tools/verify_macos_preview.py tools/dev.py` | ROOT |
| desktop | `Desktop types` | `mypy --strict src/apex_desktop` | ROOT |
| desktop | `Frontend tests` | `npm test` (접두어 없음) | FRONTEND |
| server | `MCP tests` | `pytest -q tests/mcp` | ROOT |
| server | `Backend tests` | `pytest -q tests/backend` | ROOT |
| server | `Server lint` | `ruff check src tests/mcp tools/verify_mcp_stdio.py tools/verify_mcp_package.py tools/verify_mcp_inspector.py` | ROOT |
| server | `Server types` | `mypy --strict src` | ROOT |
| server | `MCP stdio smoke` | `python tools/verify_mcp_stdio.py --module --json` | ROOT |
| server | `MCP release gate` | `python tools/verify_engine_release.py --mcp-only --json` | ROOT |

빌드 단계:

| 단계 이름 | 명령 | 작업 폴더 |
|---|---|---|
| `Build engine runtime` | `uv run --no-sync python tools/build_desktop_runtime.py` | ROOT |
| `Verify engine runtime` | `uv run --no-sync python tools/verify_desktop_runtime.py` | ROOT |
| `Package installer` | `npm run dist:mac`(darwin) / `npm run dist:win`(win32) | FRONTEND |
| `Verify macOS preview` (darwin만) | `uv run --no-sync python tools/verify_macos_preview.py` | ROOT |

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
DESKTOP = ["Desktop tests", "Desktop lint", "Desktop types", "Frontend tests"]
SERVER = [
    "MCP tests", "Backend tests", "Server lint", "Server types",
    "MCP stdio smoke", "MCP release gate",
]


def test_check_runs_everything_even_after_a_failure(frontend):
    rec = Recorder(fail="Desktop tests")
    assert dev.main(["check"], runner=rec, probe=lambda: READY) == 1
    assert [s.name for s in rec.steps] == DESKTOP + SERVER


def test_check_passes_when_every_step_passes(frontend):
    assert dev.main(["check"], runner=Recorder(), probe=lambda: READY) == 0


@pytest.mark.parametrize(("group", "names"), [("desktop", DESKTOP), ("server", SERVER)])
def test_check_can_run_one_group(frontend, group, names):
    rec = Recorder()
    assert dev.main(["check", group], runner=rec, probe=lambda: READY) == 0
    assert [s.name for s in rec.steps] == names


def test_check_rejects_an_unknown_group(frontend):
    with pytest.raises(SystemExit) as exit_info:
        dev.main(["check", "everything"], runner=Recorder(), probe=lambda: READY)
    assert exit_info.value.code == 2


def test_desktop_tests_match_the_pull_request_workflow():
    step = dev.check_steps(["desktop"])[0]
    assert step.command == (
        "uv", "run", "--no-sync", "pytest", "tests/desktop",
        "tests/unit/test_container_workflows.py",
        "tests/unit/test_advanced_runtime_decryption.py",
        "tests/unit/test_logical_content_integrity.py",
        "tests/unit/test_image_source_identity.py",
        "tests/unit/test_file_system_indexing.py",
    )


def test_build_steps_follow_the_platform(frontend):
    mac = dev.build_steps("darwin")
    assert [s.name for s in mac] == [
        "Build engine runtime", "Verify engine runtime", "Package installer",
        "Verify macOS preview",
    ]
    assert mac[2] == dev.Step("Package installer", ("npm", "run", "dist:mac"), frontend)
    windows = dev.build_steps("win32")
    assert [s.name for s in windows] == [
        "Build engine runtime", "Verify engine runtime", "Package installer",
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


def test_every_step_has_an_absolute_working_directory():
    steps = (
        dev.setup_steps(npm_current=False) + dev.build_steps("darwin")
        + dev.build_steps("win32") + dev.check_steps(["desktop", "server"])
    )
    assert all(step.cwd.is_absolute() for step in steps)
```

- [ ] **Step 2: 실패하는지 확인한다**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py`
Expected: FAIL — `check_steps`, `build_steps`가 없다.

- [ ] **Step 3: 구현한다**

- `check`와 `build`의 사전 조건은 `run`과 같다(`tool` 문제 없음, `venv_python`과 `node_modules`).
- `check`: `group` 위치 인자는 `nargs="?"`, `choices=("desktop", "server")`. 없으면 둘 다. `run_steps(..., keep_going=True)` 뒤 단계마다 `PASS`/`FAIL`과 이름을 한 줄씩 출력하고, 실패가 하나라도 있으면 1.
- `build`: 플랫폼이 `darwin`·`win32`가 아니면 `Installers are built on Windows or macOS.`를 출력하고 1. 단계가 실패하면 그 종료 코드. 성공하면 `FRONTEND/release`의 `APEX-*.dmg`, `APEX-*.zip`, `APEX-*.exe` 경로를 출력하고 0.

- [ ] **Step 4: 통과하는지 확인한다**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py && uv run --no-sync ruff check tools/dev.py tests/desktop/test_dev_script.py`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add tools/dev.py tests/desktop/test_dev_script.py
git commit -m "feat(tools): add dev check and build"
```

### Task 4: 실행 파일과 문서

**Files:**
- Create: `dev`, `dev.cmd`
- Modify: `.gitattributes`, `docs/desktop/README.md`(17–34행 "개발 실행", 75–94행 "설치 파일 빌드", 102–113행 "검증"), `frontend/README.md`(9–18행)

**Interfaces:**
- Consumes: `tools/dev.py`의 명령 다섯 개.

- [ ] **Step 1: `dev`를 만든다 (그대로)**

```sh
#!/bin/sh
# Thin launcher. All logic lives in tools/dev.py.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it, then run this again:" >&2
  echo "  brew install uv" >&2
  echo "  or: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi
exec uv run --no-project --python 3.12 "$root/tools/dev.py" "$@"
```

실행 권한을 준다: `chmod +x dev && git add dev && git update-index --chmod=+x dev`.

- [ ] **Step 2: `dev.cmd`를 만든다 (그대로, 줄바꿈 CRLF)**

```bat
@echo off
setlocal
where uv >nul 2>nul
if errorlevel 1 (
  echo uv is required. Install it, then run this again: 1>&2
  echo   winget install --id=astral-sh.uv -e 1>&2
  exit /b 1
)
uv run --no-project --python 3.12 "%~dp0tools\dev.py" %*
exit /b %errorlevel%
```

- [ ] **Step 3: `.gitattributes`에 두 줄을 더한다**

```
/dev text eol=lf
/dev.cmd text eol=crlf
```

- [ ] **Step 4: 실행 파일을 확인한다**

Run: `sh -n dev && ./dev doctor; echo "exit=$?"` 그리고 다른 폴더에서 `(cd frontend && ../dev doctor)`.
Expected: 두 번 모두 같은 항목 일곱 개가 나오고 traceback이 없다. `git ls-files -s dev`의 모드가 `100755`.

- [ ] **Step 5: 문서를 고친다**

`docs/desktop/README.md`:
- "개발 실행"의 명령 블록(21–28행)을 아래로 바꾼다. 요구 사항 문장(Python 3.12, Node.js 24, uv, Mac 아키텍처 일치)은 남긴다.

  ```sh
  ./dev setup    # Windows: .\dev setup
  ./dev run
  ```

  바로 아래에 다음 내용을 한국어 문장으로 적는다: `setup`이 Python 3.12와 의존성, 음성 인식 모델, 프런트 패키지를 설치한다. 다시 실행해도 된다. 무엇이 빠졌는지는 `./dev doctor`로 본다. uv와 Node.js는 직접 설치해야 한다. 실제로 실행되는 명령은 `tools/dev.py`에 있다. Windows의 `dev.cmd`는 아직 실제 Windows에서 확인하지 않았다.
- "설치 파일 빌드"의 명령 블록(79–86행)과 그 아래 `npm run dist:win`/`dist:mac` 문장(88행)을 `./dev build` 하나로 바꾸고, 이 명령이 런타임 빌드 → 런타임 검증 → 설치 파일 → (Mac) DMG·ZIP 검증을 차례로 한다고 적는다. 결과물 위치 `frontend/release/`는 남긴다. `tools/build_desktop_runtime.ps1` 언급과 서명 관련 문단은 그대로 둔다.
- "검증"의 명령 블록(104–113행)을 아래로 바꾼다.

  ```sh
  ./dev check            # CI의 데스크톱·서버 검사 전부
  ./dev check desktop    # 데스크톱만
  ./dev check server     # MCP·인증 백엔드만
  ```

`frontend/README.md`: 9–16행의 명령 블록을 `./dev setup`과 `./dev run` 두 줄로 바꾸고, 주석을 `# 저장소 루트에서 실행, Node.js 24 / uv 필요`로 고친다.

- [ ] **Step 6: 커밋**

```bash
git add dev dev.cmd .gitattributes docs/desktop/README.md frontend/README.md
git commit -m "feat(tools): add dev launchers and document them"
```

### Task 5: 새로 받은 저장소에서 실제 확인, PR

**Files:** 없음(확인만). 문제가 나오면 해당 태스크의 파일을 고치고 테스트를 더한다.

**Interfaces:**
- Consumes: 브랜치 `feat/dev-script` 전체.

확인은 경로에 공백이 있는 임시 폴더에서 한다. 스크래치 폴더 아래 `apex fresh clone`을 쓴다. 오래 걸리는 명령(`setup`, `build`)은 백그라운드로 돌린다.

- [ ] **Step 1: 새로 받는다**

Run: `git clone --branch feat/dev-script "$PWD" "<스크래치>/apex fresh clone"` 뒤 그 폴더로 이동.

- [ ] **Step 2: `doctor`가 빠진 것을 알려 주는지 본다**

Run: `./dev doctor; echo "exit=$?"`
Expected: `exit=1`. `Python environment`, `Frontend packages`, `Desktop assets`가 `[fix]`이고 `Run ./dev setup`을 안내한다. `uv`, `Node.js`, `Architecture`는 `[ok]`.

- [ ] **Step 3: `setup`**

Run: `./dev setup; echo "exit=$?"`
Expected: 세 단계가 차례로 끝나고 `Next: ./dev run`, `exit=0`. 이어서 `./dev doctor`가 `exit=0`(`Desktop runtime`만 `[note]`). `./dev setup`을 한 번 더 돌리면 `Install frontend packages` 없이 두 단계만 돌고 훨씬 빨리 끝난다.

- [ ] **Step 4: `run`**

실행 전에 사용자에게 열려 있는 APEX를 닫아 달라고 한다(한 번에 하나만 뜬다). 이 실행은 사용자의 평소 개발 프로필을 쓰므로 사건을 만들거나 설정을 바꾸지 않는다.

Run: `./dev run`(백그라운드)
Expected: Electron 창이 뜨고 하단 상태 표시줄에 분석 엔진이 연결된 것으로 나온다. 화면을 캡처해 사용자에게 보낸다. `pgrep -fl "apex fresh clone/.venv"`에 `apex_desktop` 프로세스가 보인다(새로 받은 폴더의 Python을 쓴다는 증거). 그다음 `./dev run` 프로세스 그룹에 SIGINT를 보낸다.
Expected: 출력에 `Traceback`이 없고 종료 코드 130. 몇 초 뒤 `pgrep -fl "apex fresh clone"`에 아무것도 없다.

- [ ] **Step 5: `check`**

Run: `./dev check; echo "exit=$?"`
Expected: 열 줄이 모두 `PASS`, `exit=0`. 실패가 있으면 같은 명령을 메인 체크아웃에서 직접 돌려 스크립트 문제인지 기존 문제인지 가른다. 기존 문제면 고치지 않고 그대로 보고한다.

- [ ] **Step 6: `build`**

Run: `./dev build; echo "exit=$?"`
Expected: 네 단계가 끝나고 `frontend/release/APEX-0.2.2-macOS-arm64.dmg`와 `.zip`의 경로가 출력된다. `exit=0`. `frontend/release/verification-macOS-arm64.json`이 있다.

- [ ] **Step 7: 정리하고 PR을 연다**

새로 받은 폴더를 지운다. 메인 체크아웃에서 `git push -u origin feat/dev-script` 뒤 PR을 연다. 제목 `feat(tools): one dev command for setup, run, build, and checks`. 본문에 무엇을 실제로 돌려 확인했는지(Step 2–6의 결과), 확인하지 못한 것(Windows의 `dev.cmd`와 실제 `setup`·`build`), `Closes #<이슈 번호>`를 적는다. `gh pr checks`로 결과를 본다. 병합은 사용자가 정한다.

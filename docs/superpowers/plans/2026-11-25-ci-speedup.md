# 데스크톱 CI/CD 시간 단축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR 검사를 Windows·macOS arm64의 테스트만으로 줄이고, 설치 파일 빌드를 main·릴리스·수동 실행으로 옮기며, 세 워크플로가 공용 워크플로 하나와 `./dev`를 쓰게 한다.

**Architecture:** job 구성은 `workflow_call`로만 불리는 `.github/workflows/desktop-build.yml` 하나에 둔다(`checks`와 `installers` 두 job, 서로 기다리지 않음). `desktop-ci.yml`, `desktop-preview-release.yml`, `desktop-release.yml`은 트리거·preflight·publish만 갖고 그 파일을 부른다. 실행하는 명령은 `tools/dev.py`에만 있다.

**Tech Stack:** GitHub Actions(재사용 워크플로, `actions/cache`), Python 3.12 표준 라이브러리, uv, pytest, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-25-ci-speedup-design.md`

## Global Constraints

- **시작 조건:** PR #117(`feat/dev-script`)이 `main`에 병합돼 있어야 한다. 아니면 멈추고 사용자에게 묻는다.
- 작업 브랜치는 이 워크트리의 브랜치를 `origin/main` 위로 리베이스한 뒤 거기서 딴 `ci/desktop-speedup`이다. `main`은 PR로만 들어가고, 병합은 사용자가 정한다.
- 커밋·PR 본문에 Claude 관련 문구(Co-Authored-By, Generated with)를 넣지 않는다.
- 이슈를 만들어 `in progress` 라벨과 담당자를 붙이고, PR 본문에 `Closes #N`을 쓴다.
- `tools/dev.py`는 표준 라이브러리만 import한다. 스크립트가 출력하는 글은 영어, 문서는 한국어.
- 명령은 인자 목록으로 실행한다. `shell=True`와 문자열 명령을 쓰지 않는다.
- 액션 버전은 지금 것을 유지한다: `actions/checkout@v4`, `actions/setup-node@v4`(Node `'24'`), `astral-sh/setup-uv@v6`(uv `'0.12.11'`), `actions/upload-artifact@v4`, `actions/download-artifact@v4`, `actions/github-script@v7`. 새로 쓰는 것은 `actions/cache@v4`뿐이다.
- 러너: `windows-latest`(라벨 `Windows-x64`), `macos-15`(`macOS-arm64`), `macos-15-intel`(`macOS-x64`).
- `mcp-ci.yml`은 건드리지 않는다.
- 릴리스 워크플로 두 개는 **절대 실행하지 않는다**(실행하면 릴리스가 게시된다).
- 서명 다섯 단계("Prepare temporary Apple API key" ~ "Remove temporary notarization key")는 글자 그대로 옮긴다. 바꿔도 되는 것은 `if:` 앞에 `inputs.signed &&`를 붙이는 것뿐이다.
- 각 태스크 완료 조건: `uv run --no-sync pytest tests/desktop/test_dev_script.py`와 `uv run --no-sync ruff check tools/dev.py tests/desktop/test_dev_script.py` 통과, `git diff --check` 깨끗함.
- 보고할 때 실측과 추정을 구분한다. 검증을 빼야 하는 상황이 생기면 말없이 빼지 않고 사용자에게 알린다.

## Review Focus

1. **런타임 없이 `./dev build installer`** — 런타임이 없거나 다른 OS·아키텍처용이면 Node 오류 대신 무엇을 먼저 하라는 안내와 종료 코드 1이 나와야 한다 → Task 2.
2. **`check` 인자** — 같은 묶음을 두 번 주면 한 번만 돌고, 모르는 묶음은 쓸 수 있는 이름을 보여 주며 종료 코드 2로 끝나야 한다 → Task 1.
3. **끝까지 실패하는 재시도와 대기 중 Ctrl-C** — 세 번 실패하면 마지막 종료 코드를 돌려주고 뒤 단계를 돌리지 않는다. 대기 중 Ctrl-C는 재시도 없이 130으로 끝난다 → Task 3.
4. **`tools/dev.py`·`dev`·`dev.cmd`만 바뀐 PR** — 데스크톱 검사가 돌아야 한다(지금은 돌지 않는다) → Task 4의 경로 필터 테스트.
5. **릴리스 시작 시 취소할 main 실행이 없거나 취소 호출이 실패** — 릴리스는 계속돼야 한다 → Task 5(빈 목록으로 명령을 실제로 돌려 본다).

---

## File Structure

- `tools/dev.py` — 수정. `engine` 묶음, 묶음 여러 개, `build` 부분 실행, 재시도, 소요 시간.
- `tests/desktop/test_dev_script.py` — 수정. 위 동작의 단위 테스트, 워크플로 일치 테스트 교체.
- `.github/workflows/desktop-build.yml` — 생성. 공용 job 구성.
- `.github/workflows/desktop-ci.yml` — 수정. 트리거·concurrency·호출만 남긴다.
- `.github/workflows/desktop-preview-release.yml`, `.github/workflows/desktop-release.yml` — 수정. `build` job을 호출로 바꾸고 preflight에 취소 단계를 더한다.
- `docs/desktop/README.md`, `docs/desktop/MACOS_SIGNED_RELEASE.md` — 수정. CI 설명.

### Task 0: 브랜치와 이슈

- [ ] **Step 1: #117 병합 확인**

Run: `gh pr view 117 --json state,mergedAt`
Expected: `"state":"MERGED"`. 아니면 여기서 멈추고 사용자에게 묻는다.

- [ ] **Step 2: 브랜치 준비**

```bash
git fetch origin main
git rebase origin/main
git switch -c ci/desktop-speedup
git log -1 --format='%an <%ae>'   # choieunsoo의 GitHub noreply 주소여야 한다
```

- [ ] **Step 3: 개발 환경**

Run: `./dev setup` 그다음 `./dev check desktop`
Expected: 요약의 모든 줄이 `PASS`. 실패가 있으면 이 작업 전부터 있던 것인지 `origin/main`에서 확인하고 기록한다.

- [ ] **Step 4: 이슈**

`gh issue create`로 "데스크톱 CI/CD 시간 단축" 이슈를 만들고(본문: 설계 문서 경로와 성공 기준 네 줄), `in progress` 라벨과 담당자 `@me`를 붙인다. 번호를 PR 본문에 쓴다.

### Task 1: `check`의 `engine` 묶음과 묶음 여러 개

**Files:**
- Modify: `tools/dev.py` (`check_steps`, `_check`, `main`의 인자 파서)
- Test: `tests/desktop/test_dev_script.py`

**Interfaces:**
- Produces:
  - `GROUPS: tuple[str, ...] = ("desktop", "engine", "server")`
  - `check_steps(groups: Sequence[str]) -> list[Step]` — `"engine"`은 `Step("Engine tests", ("uv", "run", "--no-sync", "pytest", "tests/unit", "tests/integration"), ROOT)` 하나.
  - CLI: `dev check [GROUP ...]`. 인자가 없으면 `GROUPS` 전부. 주어진 순서대로, 중복은 한 번만.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

기존 `DESKTOP`, `SERVER` 옆에 `ENGINE = ["Engine tests"]`를 두고 다음을 고치거나 더한다.

```python
def test_check_runs_everything_even_after_a_failure(frontend):
    rec = Recorder(fail="Desktop tests")
    assert dev.main(["check"], runner=rec, probe=lambda: READY) == 1
    assert [s.name for s in rec.steps] == DESKTOP + ENGINE + SERVER


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
```

`test_check_can_run_one_group`은 위 매개변수 테스트로 대체한다. `test_every_step_has_an_absolute_working_directory`의 목록에 `"engine"`을 더한다.

- [ ] **Step 2: 실패 확인**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py -k "check or engine or absolute"`
Expected: 새 테스트가 `KeyError: 'engine'` 또는 인자 오류로 FAIL.

- [ ] **Step 3: 구현**

인자는 `nargs="*"`로 받고 `choices` 대신 `type=` 검사 함수를 쓴다(`nargs="*"`와 `choices`를 함께 쓰면 인자가 없을 때의 동작이 Python 버전마다 다르다). 검사 함수는 모르는 이름에 `argparse.ArgumentTypeError("choose from desktop, engine, server")`를 낸다. 중복 제거는 `dict.fromkeys`.

- [ ] **Step 4: 통과 확인**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py` 그리고 `uv run --no-sync ruff check tools/dev.py tests/desktop/test_dev_script.py`
Expected: 모두 통과.

- [ ] **Step 5: 실제 실행**

Run: `./dev check engine`
Expected: `PASS  Engine tests`. 로컬 macOS arm64 기준 약 1분.

- [ ] **Step 6: 커밋**

```bash
git add tools/dev.py tests/desktop/test_dev_script.py
git commit -m "feat(tools): dev check takes several groups and gains the engine suites"
```

### Task 2: `build`의 부분 실행

**Files:**
- Modify: `tools/dev.py` (`build_steps`, `_build`, `main`의 인자 파서)
- Test: `tests/desktop/test_dev_script.py`

**Interfaces:**
- Produces:
  - `BUILD_PARTS: tuple[str, ...] = ("runtime", "installer")`
  - `build_steps(platform_name: str, parts: Sequence[str] = BUILD_PARTS) -> list[Step]` — `runtime`: "Build engine runtime", "Verify engine runtime". `installer`: "Package installer", macOS는 "Verify macOS preview"까지. 단계 이름과 명령은 지금과 같다.
  - CLI: `dev build [runtime|installer]`. 인자가 없으면 둘 다 순서대로.
  - `RUNTIME_FIRST = "Build the engine runtime first: {launcher} build runtime"` — `installer`만 요청했는데 쓸 수 있는 런타임이 없을 때 출력하고 1을 돌려준다. "쓸 수 있는 런타임" = `env.runtime`이 있고 `platform`이 `env.platform`과, `arch`가 `env.python_arch`와 같다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
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
```

기존 `test_build_steps_follow_the_platform`, `test_build_stops_at_the_first_failure`, `test_build_refuses_other_platforms`는 그대로 통과해야 한다(인자 없는 `build`는 `runtime`이 `None`이어도 돈다).

- [ ] **Step 2: 실패 확인**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py -k build`
Expected: 새 테스트 FAIL(인자 오류 또는 단계 목록 불일치).

- [ ] **Step 3: 구현**

산출물 경로 출력은 `installer`가 포함된 실행에서만 한다.

- [ ] **Step 4: 통과 확인**

Run: Task 1 Step 4와 같은 두 명령.
Expected: 모두 통과.

- [ ] **Step 5: 커밋**

```bash
git add tools/dev.py tests/desktop/test_dev_script.py
git commit -m "feat(tools): dev build can run the runtime or installer part alone"
```

### Task 3: 재시도와 소요 시간

**Files:**
- Modify: `tools/dev.py` (`Step`, `run_steps`, `build_steps`, `_check`, `_build`, `_setup`)
- Test: `tests/desktop/test_dev_script.py`

**Interfaces:**
- Produces:
  - `Step`에 필드 `attempts: int = 1` 추가. "Build engine runtime"과 "Package installer"만 `attempts=3`.
  - `RETRY_DELAY: float = 5.0` — 재시도 사이에 `time.sleep(RETRY_DELAY)`. 호출 시점에 전역을 읽는다(테스트가 0으로 바꾼다).
  - `@dataclass(frozen=True) class Outcome` — `step: Step`, `code: int`, `seconds: float`(재시도와 대기를 포함한 그 단계 전체 시간, `time.monotonic` 기준).
  - `run_steps(steps: Sequence[Step], runner: Runner, *, keep_going: bool = False) -> list[Outcome]`
  - `summarize(outcomes: Sequence[Outcome]) -> None` — 단계마다 `PASS  <이름>  <초>s` 또는 `FAIL  <이름>  <초>s`를 한 줄씩(초는 정수로 반올림). `_check`와 `_build`가 끝에 부른다.
  - 재시도 직전에 `Attempt {n} of {total} failed; retrying in {RETRY_DELAY:g} seconds.`를 출력한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```python
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
    assert dev.main(["build", "runtime"], runner=Recorder(fail="Verify engine runtime"), probe=lambda: READY) == 1
    out = capsys.readouterr().out
    assert re.search(r"^PASS  Build engine runtime  \d+s$", out, re.M)
    assert re.search(r"^FAIL  Verify engine runtime  \d+s$", out, re.M)
```

`import re`를 더한다. 기존 `test_build_steps_follow_the_platform`의 `mac[2] == dev.Step("Package installer", ("npm", "run", "dist:mac"), frontend)`는 `attempts=3`을 넣어 고친다.

- [ ] **Step 2: 실패 확인**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py -k "retried or failing or interrupt or summaries or follow"`
Expected: FAIL(`attempts` 속성 없음 등).

- [ ] **Step 3: 구현**

`_build`의 반환값은 지금처럼 마지막 단계의 종료 코드다. `_setup`은 `Outcome`을 읽도록만 고치고 요약은 출력하지 않는다.

- [ ] **Step 4: 통과 확인**

Run: Task 1 Step 4와 같은 두 명령.
Expected: 모두 통과.

- [ ] **Step 5: 커밋**

```bash
git add tools/dev.py tests/desktop/test_dev_script.py
git commit -m "feat(tools): retry the download-heavy build steps and report step durations"
```

### Task 4: 공용 워크플로와 PR 검사

**Files:**
- Create: `.github/workflows/desktop-build.yml`
- Modify: `.github/workflows/desktop-ci.yml` (전체 교체)
- Test: `tests/desktop/test_dev_script.py`

**Interfaces:**
- Consumes: `./dev setup`, `./dev check <groups>`, `./dev build runtime`, `./dev build installer` (Task 1~3).
- Produces: `desktop-build.yml`의 입력 `full`, `ref`, `signed`, `artifact-prefix`, `retention-days`와 시크릿 여섯 개. 업로드 이름 `<artifact-prefix>-<라벨>`. Task 5가 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test_desktop_checks_are_the_commands_the_pull_request_workflow_runs`와 `test_setup_installs_every_extra_a_workflow_installs`를 지우고 다음을 쓴다. `test_server_checks_are_the_commands_the_mcp_workflow_runs`는 그대로 둔다.

```python
DIRECT = (
    "uv sync",
    "uv run --no-sync pytest",
    "uv run --no-sync ruff",
    "uv run --no-sync mypy",
    "uv run --no-sync python tools/build_desktop_runtime.py",
    "npm ci",
    "npm test",
)


@pytest.mark.parametrize("name", ["desktop-build.yml", "desktop-ci.yml"])
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


def test_setup_installs_every_extra_the_mcp_workflow_installs():
    extras = set()
    for command in workflow_commands("mcp-ci.yml"):
        if command.startswith("uv sync"):
            words = command.split()
            extras.update(words[i + 1] for i, word in enumerate(words) if word == "--extra")
    assert extras and extras <= set(dev.EXTRAS)
```

- [ ] **Step 2: 실패 확인**

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py -k "workflow or trigger or extra"`
Expected: `desktop-build.yml` 없음과 `uv sync` 직접 호출로 FAIL.

- [ ] **Step 3: `.github/workflows/desktop-build.yml`을 만든다**

```yaml
name: Desktop build
on:
  workflow_call:
    inputs:
      full:
        description: Check all three platforms and build installers. Otherwise check Windows and macOS arm64 only.
        type: boolean
        default: false
      ref:
        description: Commit to check out. Empty means the ref that started the caller.
        type: string
        default: ''
      signed:
        description: Sign and notarize instead of building the certificate-free preview.
        type: boolean
        default: false
      artifact-prefix:
        type: string
        default: APEX
      retention-days:
        description: 0 keeps the repository default.
        type: number
        default: 0
    secrets:
      MAC_CSC_LINK:
        required: false
      MAC_CSC_KEY_PASSWORD:
        required: false
      APPLE_API_KEY_BASE64:
        required: false
      APPLE_API_KEY_ID:
        required: false
      APPLE_API_ISSUER:
        required: false
      APPLE_TEAM_ID:
        required: false
permissions:
  contents: read
env:
  PYTHONUTF8: '1'
  ORT_DISABLE_TELEMETRY: '1'
  HF_HUB_DISABLE_TELEMETRY: '1'
jobs:
  checks:
    name: checks (${{ matrix.label }})
    strategy:
      fail-fast: false
      matrix:
        include: >-
          ${{ fromJSON(inputs.full
          && '[{"os":"windows-latest","label":"Windows-x64","groups":"desktop engine"},{"os":"macos-15","label":"macOS-arm64","groups":"desktop engine"},{"os":"macos-15-intel","label":"macOS-x64","groups":"desktop engine"}]'
          || '[{"os":"windows-latest","label":"Windows-x64","groups":"desktop"},{"os":"macos-15","label":"macOS-arm64","groups":"desktop engine"}]') }}
    runs-on: ${{ matrix.os }}
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref }}
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - uses: astral-sh/setup-uv@v6
        with:
          version: '0.12.11'
      - uses: actions/cache@v4
        with:
          path: build/desktop-downloads
          key: desktop-downloads-${{ runner.os }}-${{ hashFiles('tools/desktop-assets.lock.json') }}
      - run: ./dev setup
      - run: ./dev check ${{ matrix.groups }}
  installers:
    if: inputs.full
    name: installers (${{ matrix.label }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            label: Windows-x64
          - os: macos-15
            label: macOS-arm64
          - os: macos-15-intel
            label: macOS-x64
    runs-on: ${{ matrix.os }}
    timeout-minutes: ${{ inputs.signed && 120 || 45 }}
    steps:
      # checkout, setup-node, setup-uv, cache: the same four steps as in `checks`
      - run: ./dev setup
      - run: ./dev build runtime
      - name: Build preview installer
        if: ${{ !inputs.signed }}
        run: ./dev build installer
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      # signed steps are added in Task 5
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ inputs.artifact-prefix }}-${{ matrix.label }}
          path: |
            frontend/release/APEX-*.exe
            frontend/release/APEX-*.dmg
            frontend/release/APEX-*.zip
            frontend/release/verification-macOS-*.json
          if-no-files-found: error
          retention-days: ${{ inputs.retention-days }}
          compression-level: 0
```

`./dev` 단계에는 `shell:`을 주지 않는다(Windows는 PowerShell이 `dev.cmd`를 찾아야 한다). 첫 주석은 `checks`의 네 단계로 바꿔 쓰고, 둘째 주석은 지운다(Task 5가 그 자리에 단계를 넣는다).

- [ ] **Step 4: `.github/workflows/desktop-ci.yml`을 교체한다**

```yaml
name: Desktop Windows and macOS
on:
  pull_request:
    paths: ['frontend/**', 'src/apex_desktop/**', 'src/apex_forensic/**', 'schemas/**', 'tests/desktop/**', 'tests/unit/**', 'tests/integration/**', 'tools/*desktop*', 'tools/dev.py', 'tools/verify_macos_release.py', 'tools/verify_macos_preview.py', 'dev', 'dev.cmd', 'docs/desktop/third-party/**', 'pyproject.toml', 'uv.lock', '.github/workflows/desktop-ci.yml', '.github/workflows/desktop-build.yml', '.github/workflows/desktop-release.yml', '.github/workflows/desktop-preview-release.yml']
  push:
    branches: [main]
    paths: [위와 같은 목록]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: desktop-ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  desktop:
    uses: ./.github/workflows/desktop-build.yml
    with:
      full: ${{ github.event_name != 'pull_request' }}
```

`push`의 `paths`에는 같은 목록을 그대로 한 번 더 적는다(YAML 앵커를 쓰지 않는다).

- [ ] **Step 5: 로컬 확인**

Run: `uv run --no-sync python -c "import yaml,sys; [yaml.safe_load(open(f, encoding='utf-8')) for f in sys.argv[1:]]" .github/workflows/desktop-build.yml .github/workflows/desktop-ci.yml`
Expected: 출력 없이 종료 코드 0.

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py`
Expected: 모두 통과.

- [ ] **Step 6: 커밋, 푸시, PR**

```bash
git add .github/workflows/desktop-build.yml .github/workflows/desktop-ci.yml tests/desktop/test_dev_script.py
git commit -m "ci(desktop): one shared workflow; pull requests run checks on Windows and macOS arm64"
git push -u origin ci/desktop-speedup
gh pr create --draft --title "ci(desktop): shorten pull request checks and releases" --body "Closes #<이슈 번호>"
```

초안 PR로 연다. 본문은 Task 6에서 채운다.

- [ ] **Step 7: PR 범위 실제 실행 확인**

Run: `gh run list --workflow desktop-ci.yml --branch ci/desktop-speedup --limit 1` 그다음 `gh run watch <id>`(백그라운드)
Expected: job이 `desktop / checks (Windows-x64)`와 `desktop / checks (macOS-arm64)` 두 개뿐이고 둘 다 성공.

Windows job이 `./dev setup`에서 "명령을 찾을 수 없음"류로 실패하면: `checks`의 matrix 항목과 `installers`의 matrix 항목에 `dev: ./dev`(macOS), `dev: .\dev.cmd`(Windows)를 넣고 `run: ${{ matrix.dev }} setup`처럼 부른다. `test_the_shared_workflow_calls_the_dev_script`의 기대 문자열도 그에 맞춘다. 이 사실(문서의 `.\dev`가 PowerShell에서 동작하지 않음)을 기록해 Task 6의 보고에 넣는다.

- [ ] **Step 8: 전체 범위 실제 실행 확인**

Run: `gh workflow run "Desktop Windows and macOS" --ref ci/desktop-speedup` 그다음 실행을 지켜본다(백그라운드).
Expected: `checks` 세 개와 `installers` 세 개. `installers`는 모두 성공하고 아티팩트 `APEX-Windows-x64`, `APEX-macOS-arm64`, `APEX-macOS-x64`가 생긴다.

`Engine tests`가 Windows나 Intel에서 실패하면: 원인을 읽는다. 테스트나 코드의 작은 수정으로 끝나면 고친다. 아니면 그 OS의 `groups`에서 `engine`을 빼고 이슈를 만든 뒤 사용자에게 보고한다. 말없이 빼지 않는다.

### Task 5: 릴리스 워크플로 두 개

**Files:**
- Modify: `.github/workflows/desktop-build.yml` (서명 단계)
- Modify: `.github/workflows/desktop-preview-release.yml`
- Modify: `.github/workflows/desktop-release.yml`
- Modify: `docs/desktop/README.md`, `docs/desktop/MACOS_SIGNED_RELEASE.md`

**Interfaces:**
- Consumes: `desktop-build.yml`의 입력과 시크릿(Task 4).

- [ ] **Step 1: 릴리스 두 파일을 테스트에 넣는다**

`test_desktop_workflows_leave_the_commands_to_the_dev_script`의 목록에 `"desktop-preview-release.yml"`, `"desktop-release.yml"`을 더한다.

Run: `uv run --no-sync pytest tests/desktop/test_dev_script.py -k leave`
Expected: 더한 두 케이스가 `uv sync` 등 직접 호출로 FAIL.

- [ ] **Step 2: 서명 단계를 `desktop-build.yml`로 옮긴다**

`installers`의 "Build preview installer" 뒤, 업로드 앞에 `desktop-release.yml`의 다섯 단계를 순서대로 붙인다: "Prepare temporary Apple API key", "Package Windows preview", "Sign and notarize macOS application", "Notarize DMG and verify shipped DMG/ZIP payloads", "Remove temporary notarization key". 바꾸는 것은 `if:`뿐이다.

| 원래 `if:` | 새 `if:` |
|---|---|
| `runner.os == 'macOS'` | `inputs.signed && runner.os == 'macOS'` |
| `runner.os == 'Windows'` | `inputs.signed && runner.os == 'Windows'` |
| `always() && runner.os == 'macOS'` | `always() && inputs.signed && runner.os == 'macOS'` |

- [ ] **Step 3: 원본과 대조한다**

Run: `git show origin/main:.github/workflows/desktop-release.yml | sed -n '/Prepare temporary Apple API key/,/apex-notary.p8/p' > /tmp/signed-before.txt` 와 새 파일의 같은 구간을 뽑아 `diff`한다(임시 파일은 스크래치패드에 둔다).
Expected: 차이는 들여쓰기와 `if:` 세 종류뿐이다. `run:`, `env:`, `working-directory:`, `shell:` 줄은 한 글자도 다르지 않다.

- [ ] **Step 4: `desktop-preview-release.yml`을 고친다**

- `on:`에서 `push:` 블록 세 줄을 지운다. `workflow_dispatch:`만 남는다.
- `preflight` job에 권한을 준다:

```yaml
    permissions:
      contents: read
      actions: write
```

- `preflight`의 마지막 단계로 더한다(버전 검사 **뒤**):

```yaml
      - name: Cancel the main check run for this commit
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh run list --repo "$GITHUB_REPOSITORY" --workflow desktop-ci.yml --commit "$GITHUB_SHA" \
            --json databaseId,status --jq '.[] | select(.status != "completed") | .databaseId' \
            | xargs -r -n1 gh run cancel --repo "$GITHUB_REPOSITORY"
```

- `build` job 전체(`strategy`부터 업로드까지)를 다음으로 바꾼다:

```yaml
  build:
    needs: preflight
    uses: ./.github/workflows/desktop-build.yml
    with:
      full: true
      ref: ${{ needs.preflight.outputs.sha }}
      artifact-prefix: preview
      retention-days: 14
```

- `publish`는 건드리지 않는다(`needs: [preflight, build]`, `pattern: preview-*`).

- [ ] **Step 5: `desktop-release.yml`을 고친다**

Step 4와 같은 세 가지(권한, 취소 단계, `build` 교체)를 한다. `build`는 `signed: true`, `artifact-prefix: release`를 쓰고 시크릿 여섯 개를 이름 그대로 넘긴다:

```yaml
    with:
      full: true
      ref: ${{ needs.preflight.outputs.sha }}
      signed: true
      artifact-prefix: release
      retention-days: 14
    secrets:
      MAC_CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
      MAC_CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
      APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}
      APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
      APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
      APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

이 파일에는 원래 `push` 트리거가 없다. `preflight`의 `timeout-minutes: 5`와 `publish`의 `timeout-minutes: 15`는 그대로 둔다.

- [ ] **Step 6: 취소 명령을 빈 목록으로 돌려 본다**

Run (로컬, 실행이 없는 커밋으로): `gh run list --workflow desktop-ci.yml --commit 0000000000000000000000000000000000000000 --json databaseId,status --jq '.[] | select(.status != "completed") | .databaseId' | xargs -n1 echo would-cancel`
Expected: 아무것도 출력하지 않고 종료 코드 0. (macOS의 `xargs`는 입력이 없으면 명령을 돌리지 않는다. 러너는 Ubuntu라 `-r`을 붙였다.)

Run (끝난 실행이 있는 커밋으로): 같은 명령에 `--commit <Task 4 Step 7의 커밋>`
Expected: 그 실행이 끝났으면 출력 없음. 도는 중이면 `would-cancel <id>` 한 줄.

- [ ] **Step 7: 문서를 고친다**

- `docs/desktop/README.md`의 `.github/workflows/desktop-ci.yml` 문단: PR에서는 Windows x64·macOS arm64에서 테스트·린트·타입 검사만 하고, 세 OS의 런타임 빌드·실행 확인·패키징은 main 병합 뒤와 릴리스·수동 실행(`gh workflow run "Desktop Windows and macOS" --ref <브랜치>`)에서 한다고 적는다. 공용 파일 `desktop-build.yml`을 언급한다.
- `docs/desktop/MACOS_SIGNED_RELEASE.md` 7행: "`Desktop Windows and macOS` PR CI와 …은 … ad-hoc 프리뷰를 검증·배포한다"를 "main 병합 뒤의 `Desktop Windows and macOS` 실행과 …"로 고친다. 서명 단계가 `desktop-build.yml`에 있다는 한 줄을 더한다.

- [ ] **Step 8: 확인**

Run: Task 4 Step 5의 YAML 로드 명령에 네 파일을 모두 주고, `uv run --no-sync pytest tests/desktop/test_dev_script.py`, `uv run --no-sync ruff check tools/dev.py tests/desktop/test_dev_script.py`, `git diff --check`.
Expected: 모두 통과.

- [ ] **Step 9: 커밋과 푸시**

```bash
git add .github/workflows tests/desktop/test_dev_script.py docs/desktop/README.md docs/desktop/MACOS_SIGNED_RELEASE.md
git commit -m "ci(desktop): releases call the shared workflow and take over the main run"
git push
```

Expected: 이 푸시로 뜬 PR 검사가 두 job 모두 성공한다.

### Task 6: 측정과 보고

**Files:** 없음(PR 본문과 보고).

- [ ] **Step 1: 실행을 모은다**

필요한 실행: PR 범위 두 번(다운로드 캐시 없음/있음), 전체 범위 두 번(없음/있음). 캐시 있는 실행은 `gh run rerun <id>` 또는 빈 커밋 없이 같은 커밋의 재실행으로 얻는다. 각 실행에서 `actions/cache` 단계 로그의 "Cache restored"/"Cache not found"로 어느 쪽인지 확인한다.

- [ ] **Step 2: 시간을 뽑는다**

Run: `gh run view <id> --json jobs --jq '.jobs[] | "\(.name)\t\((.completedAt|fromdate) - (.startedAt|fromdate))s", (.steps[] | "  \(.name)\t\((.completedAt|fromdate) - (.startedAt|fromdate))s")'`

`./dev check`와 `./dev build` 안쪽의 단계 시간은 job 로그의 `PASS  <이름>  <초>s` 줄에서 읽는다.

- [ ] **Step 3: 연속 푸시 취소 확인**

빈 내용 변경 없이 확인한다: 커밋 하나를 푸시하고 실행이 시작되면 곧바로 다음 커밋(문서 한 줄 등 이 작업의 실제 변경)을 푸시한다.
Expected: 앞 실행의 결론이 `cancelled`.

- [ ] **Step 4: 표를 만든다**

"바꾸기 전"은 실행 44466911078(PR)과 44468943093(릴리스)의 값(설계 문서의 표). "바꾼 뒤"는 Step 2의 실측. 행: PR 검사 전체 시간, PR의 macOS 러너 사용 시간, 전체 범위 실행 시간, OS별 job 시간, 주요 단계 시간, `./dev setup` 시간(이전의 `uv sync` + `npm ci`와 비교). 캐시 없음/있음을 열로 나눈다. 릴리스 워크플로 자체의 시간은 "다음 릴리스 때 측정"으로 적고 추정치를 실측 칸에 넣지 않는다.

- [ ] **Step 5: PR 본문과 보고**

PR 본문에 무엇이 바뀌었는지, 표, 확인하지 못한 것(릴리스 워크플로 실제 실행, main 실행 취소 단계, 서명 경로), 병합 뒤 확인할 것(main 푸시 실행이 돌고 캐시가 main 범위에 저장되는지)을 적고 초안을 해제한다(`gh pr ready`). 사용자에게 같은 내용을 한국어로 보고한다. 성공 기준 네 가지 각각에 대해 달성 여부를 실측으로 답한다.

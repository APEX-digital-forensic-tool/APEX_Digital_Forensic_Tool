# 데스크톱 CI/CD 시간 단축 — 설계

작성일: 2026-11-25 · 상태: 승인됨 (2026-11-25)

## 목적

데스크톱 PR 검사와 릴리스를 기다리는 시간을 줄인다. 사용자의 말: "CI CD 파이프라인이 거의 1시간이 걸리던데 이것도 줄일 수 있니?"

기다림은 세 군데서 나온다.

1. **대기열.** 2026-11-17에 PR을 여러 개 동시에 올렸을 때 macOS job이 시작도 못 하고 6분~2시간 25분을 기다렸다(Windows job은 2~3초). PR 한 번이 macOS 러너를 27~36분 쓰고, 같은 PR에 다시 푸시해도 이전 실행이 취소되지 않는다.
2. **한 번의 실행.** PR 검사 14~29분. 테스트와 빌드가 한 job 안에서 직렬이고 Intel Mac job이 전체 시간을 정한다.
3. **릴리스의 반복.** 릴리스 워크플로가 PR 검사와 같은 일을 직렬로 다시 한다(20~27분). v0.2.2는 릴리스 PR 검사 18분 + 릴리스 27분 = 45분이었다.

성공 기준:

- PR 검사 한 번이 10분 안에 끝난다.
- 릴리스 워크플로가 20분 안에 끝난다.
- PR 한 번이 쓰는 macOS 러너 시간이 5분 안쪽이다.
- 바꾸기 전후를 `gh run view`의 job·step 시간으로 비교한 표가 있다. 추정치는 실측과 구분해 적는다.

## 결정 사항

사용자가 정한 것 (2026-11-25):

- **PR 검사는 Windows와 macOS arm64에서 테스트·린트만 한다.** 설치 파일은 PR에서 만들지 않는다. Intel Mac은 PR 검사에서 뺀다.
- 세 OS(Intel 포함)의 설치 파일은 main에 병합된 직후 자동으로 만들고 검증한다(병합을 막지 않는다). 릴리스 때 다시 만들고, 어느 브랜치에서든 수동으로 돌릴 수 있다.

설계하면서 정한 것 (사용자가 고칠 수 있다):

- 구조는 "공용 워크플로 하나 + `./dev` 호출"로 한다(아래 "검토한 방식").
- 지금 CI가 돌리지 않는 `tests/unit` 전체와 `tests/integration`을 넣는다. PR에서는 macOS arm64에서만, 전체 실행에서는 세 OS에서 돌린다. 로컬 macOS arm64에서 623개가 52초에 모두 통과했다(14개 건너뜀). Windows와 Intel에서는 돌려 본 적이 없다.
- `desktop-preview-release.yml`의 `push` 트리거를 없앤다. 지금은 이 파일을 고친 커밋이 main에 들어가면 릴리스 워크플로가 저절로 돈다. 릴리스는 수동 실행만 남긴다.
- 릴리스 워크플로를 시작하면 같은 커밋에서 돌고 있는 main 실행을 취소한다(아래 "릴리스와 main 실행의 충돌").
- 구현은 PR #117(개발 스크립트)이 main에 병합된 뒤 그 위에서 시작한다. 이 설계는 `tools/dev.py`를 고치고, Windows 빌드는 #117에 든 FFmpeg 재고정(커밋 62077b1)이 있어야 통과한다.
- 고정 자산이 업스트림에서 지워지는 문제는 이 작업에서 다루지 않는다. 월말 빌드 재고정은 #117에 들어 있고, 미러링은 후속 제안으로 남긴다.

## 하지 않는 것

- `mcp-ci.yml`은 건드리지 않는다(2~3분, 문제 없음).
- 서명·공증을 실제로 동작시키는 일은 다음 작업이다. 이 작업은 서명 단계가 들어갈 자리를 한 곳으로 모으기만 한다.
- 패키징 자체를 빠르게 하는 변경(blockmap 생략, 압축 수준 변경, PyInstaller 캐시)은 하지 않는다.
- Windows pytest 병렬화(`pytest-xdist`)는 하지 않는다.

피해야 할 결과:

- 검증을 말없이 빼서 시간을 줄이는 것. 빠지는 검증은 이 문서에 적힌 것뿐이어야 한다.
- 추정치를 실측처럼 보고하는 것.
- 정확히 그 커밋에서 검증되지 않은 설치 파일이 릴리스로 나가는 것.
- `./dev check`가 통과했는데 CI는 다른 목록을 돌려 실패하는 것.

## 지금 상태 (실측)

같은 코드(v0.2.2)의 PR 실행 44466911078과 릴리스 실행 44468943093. 단위는 초, `PR / 릴리스` 순서.

| 단계 | Windows | macOS arm64 | macOS Intel |
|---|---|---|---|
| `uv sync` | 7 / 5 | 6 / 6 | 138 / 217 |
| pytest | 267 / 229 | 74 / 68 | 113 / 148 |
| mypy | 8 / 5 미만 | 7 / 5 | 34 / 48 |
| `npm ci` | 28 / 13 | 15 / 16 | 27 / 44 |
| `npm test` | 70 / 44 | 43 / 46 | 89 / 133 |
| 런타임 빌드 | 105 / 70 | 88 / 105 | 208 / 296 |
| 런타임 검증 | 19 / 15 | 14 / 16 | 27 / 22 |
| 패키징 | 179 / 130 | 210 / 211 | 226 / 366 |
| DMG·ZIP 검증 | – | 86 / 83 | 118 / 178 |
| 업로드 | 15 / 11 | 32 / 38 | 47 / 57 |
| **job 합계** | 728 / 551 | 595 / 617 | 1053 / 1550 |

그 밖에 확인한 것:

- Intel의 `uv sync`는 두 실행 모두 캐시가 없었고 `cryptography==50.0.1`을 소스에서 빌드했다(2분 5초, 3분 19초). 다른 두 OS는 휠을 받는다. main 범위 캐시를 읽은 실행 45573143485(PR #117)에서는 Intel `uv sync`가 11초였다.
- uv 캐시 키는 `uv.lock` 해시를 포함한다. PR이 저장한 캐시는 그 PR만 읽을 수 있다. main 범위 캐시는 릴리스 워크플로가 돌 때만 생긴다.
- `main` 룰셋은 PR만 요구하고 필수 상태 검사는 없다. job 이름이 바뀌어도 병합이 막히지 않는다.
- 2026-11-25 현재 main의 Windows 런타임 빌드는 FFmpeg 주소 404로 실패한다(PR #117의 62077b1에서 고침).

## 검토한 방식

| 방식 | 좋은 점 | 나쁜 점 |
|---|---|---|
| **가. 공용 워크플로 하나 + `./dev` 호출** (선택) | job 구성이 한 파일, 명령 목록이 `tools/dev.py` 한 곳. 서명 단계를 넣을 자리가 한 군데. | 워크플로가 서로를 부르는 구조라 처음 읽을 때 한 단계 더 따라가야 한다. |
| 나. 워크플로 세 개를 각자 얇게 | 파일마다 독립이라 읽기 쉽다. | OS 목록, 캐시 설정, 업로드 설정이 세 벌로 남아 다시 어긋난다. 릴리스 목록에 테스트 하나가 빠져 있던 일이 반복된다. |
| 다. 지금 파일을 제자리에서 손보기 | PR #117 없이도 할 수 있다. | 명령 목록 중복이 그대로 남고, `test_dev_script.py`의 일치 테스트를 계속 끌고 간다. |

"가"를 고른 이유: 이 작업의 절반은 시간이고 절반은 "같은 일을 세 군데서 다르게 적어 둔 것"을 없애는 일이다. 다음 작업(서명)이 손댈 곳도 한 파일로 줄어든다.

## 구조

### 파일

| 파일 | 변경 |
|---|---|
| `.github/workflows/desktop-build.yml` | 새 파일. `workflow_call`로만 불린다. `checks`와 `installers` 두 job을 가진다. |
| `.github/workflows/desktop-ci.yml` | 트리거와 concurrency만 남기고 공용 워크플로를 부른다. |
| `.github/workflows/desktop-preview-release.yml` | `preflight`와 `publish`는 그대로. `build` job이 공용 워크플로 호출로 바뀐다. `push` 트리거 삭제. |
| `.github/workflows/desktop-release.yml` | 위와 같되 `signed: true`와 시크릿을 넘긴다. |
| `tools/dev.py` | `check`에 `engine` 묶음, `build`에 `runtime`/`installer` 부분 실행, 재시도, 단계별 소요 시간 출력. |
| `tests/desktop/test_dev_script.py` | 워크플로 일치 테스트를 새 구조에 맞게 바꾼다. |
| `docs/desktop/README.md`, `docs/desktop/MACOS_SIGNED_RELEASE.md` | CI 설명을 새 구조에 맞춘다. |

### 공용 워크플로 `desktop-build.yml`

입력:

| 이름 | 형식 | 기본값 | 뜻 |
|---|---|---|---|
| `full` | boolean | `false` | `false`: Windows·macOS arm64에서 검사만. `true`: 세 OS에서 검사 + 설치 파일. |
| `ref` | string | `''` | 체크아웃할 커밋. 릴리스가 preflight에서 정한 SHA를 넘긴다. 비면 기본 동작. |
| `signed` | boolean | `false` | `true`면 설치 파일 단계를 서명·공증 단계로 바꾼다. |
| `artifact-prefix` | string | `APEX` | 업로드 이름 앞부분. `<prefix>-<Windows-x64 등>`. 릴리스는 `preview`, `release`. |
| `retention-days` | number | `0` | 아티팩트 보관 일수. `0`은 저장소 기본값. 릴리스는 `14`. |

시크릿(모두 선택): `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`. `signed`일 때만 쓴다.

워크플로 수준 환경변수는 지금과 같다: `PYTHONUTF8=1`, `ORT_DISABLE_TELEMETRY=1`, `HF_HUB_DISABLE_TELEMETRY=1`. `CSC_IDENTITY_AUTO_DISCOVERY`는 설치 파일 단계에만 둔다(프리뷰는 `false`, 서명은 지금 `desktop-release.yml`과 같게).

시간 제한: `checks` 30분. `installers`는 프리뷰 45분, 서명 120분(지금 서명 워크플로의 값). 입력으로 받지 않고 `signed`에서 정한다.

`./dev` 명령은 러너의 기본 셸에서 부른다(macOS는 bash, Windows는 PowerShell). Windows에서 `shell: bash`를 쓰면 `dev.cmd`가 아니라 `dev`(sh)가 돌아 개발자가 쓰는 경로를 확인하지 못한다.

**job `checks`** — 테스트·린트·타입 검사.

| OS | `full: false` | `full: true` |
|---|---|---|
| `windows-latest` | `./dev check desktop` | `./dev check desktop engine` |
| `macos-15` | `./dev check desktop engine` | `./dev check desktop engine` |
| `macos-15-intel` | 돌지 않음 | `./dev check desktop engine` |

단계: 체크아웃 → Node 24(npm 캐시) → uv 0.12.11(uv 캐시) → 다운로드 캐시 복원 → `./dev setup` → `./dev check …`.

**job `installers`** — `full`일 때만. 세 OS.

단계: 체크아웃 → Node → uv → 다운로드 캐시 복원 → `./dev setup` → `./dev build runtime` → 설치 파일 단계 → 업로드.

설치 파일 단계:

- 프리뷰(`signed: false`): `./dev build installer`.
- 서명(`signed: true`): 지금 `desktop-release.yml`의 "Prepare temporary Apple API key"부터 "Remove temporary notarization key"까지 다섯 단계를 **그대로** 옮긴다. Apple API 키 준비, Windows `npm run dist:win:release`, macOS `npm run dist:mac:release`, `tools/verify_macos_release.py`, 키 삭제(`always()`). 환경변수와 조건도 그대로다.

"그대로"는 이 다섯 단계에만 해당한다. 그 앞은 서명 릴리스도 공용 경로를 탄다. 그래서 서명 릴리스에서 달라지는 것이 셋 있다: 런타임 빌드에 재시도가 생긴다(지금은 없음), 검사 목록이 PR과 같아진다(`test_file_system_indexing.py`, `verify_macos_preview.py` 린트, `engine` 묶음이 더해짐), 검사와 설치 파일이 병렬로 돈다. 모두 의도한 변화다.

업로드는 지금과 같은 파일 패턴에 `compression-level: 0`을 더한다. EXE·DMG·ZIP은 이미 압축돼 있다.

두 job은 서로 기다리지 않는다. 호출한 쪽의 `publish`는 공용 워크플로 전체를 `needs`로 걸기 때문에 검사와 설치 파일이 모두 성공해야 게시된다.

### `desktop-ci.yml`

- 트리거: `pull_request`(경로 필터), `push`(브랜치 `main`, 같은 경로 필터), `workflow_dispatch`.
- `full`: `pull_request`일 때만 `false`. main 푸시와 수동 실행은 `true`.
- concurrency: 그룹 `desktop-ci-${{ github.ref }}`, `cancel-in-progress: true`. 같은 PR에 다시 푸시하면 이전 실행이 취소된다. main에 연달아 병합하면 마지막 커밋만 끝까지 돈다. main에서의 수동 실행과 main 푸시 실행은 같은 그룹이라 나중 것이 앞의 것을 취소한다(둘 다 같은 전체 범위이므로 괜찮다). 취소된 main 실행은 "cancelled"로 남는다. 받아들인다.
- 경로 필터에 더할 것: `tools/dev.py`, `dev`, `dev.cmd`, `tests/unit/**`, `tests/integration/**`, `.github/workflows/desktop-build.yml`. 지금 따로 적힌 `tests/unit` 파일 세 개는 `tests/unit/**`로 합친다.
- PR에서 설치 파일까지 확인하고 싶을 때: `gh workflow run "Desktop Windows and macOS" --ref <브랜치>`.

### 릴리스 워크플로 두 개

- `preflight`와 `publish`의 내용은 바꾸지 않는다. `publish`의 아티팩트 패턴(`preview-*`, `release-*`)이 `artifact-prefix`와 맞아야 한다.
- 가운데 `build` job이 `uses: ./.github/workflows/desktop-build.yml`로 바뀐다. `full: true`, `ref: <preflight의 sha>`, `retention-days: 14`.
- 릴리스의 pytest 목록에 `tests/unit/test_file_system_indexing.py`가 빠져 있던 문제는 목록이 한 곳이 되면서 없어진다.

### 릴리스와 main 실행의 충돌

릴리스 PR은 `frontend/package.json`을 바꾸므로 병합하면 main 전체 실행이 시작된다. 바로 이어 릴리스 워크플로를 시작하면 같은 커밋에서 macOS job 8개가 동시에 뜬다. 11월 17일의 대기 기록은 macOS 동시 실행에 한도가 있음을 보여 준다(표준 요금제는 5개로 알려져 있다). 릴리스 job이 줄을 서면 줄인 시간이 다시 사라진다.

그래서 릴리스 워크플로의 `preflight`가, 같은 커밋에서 돌거나 대기 중인 `desktop-ci.yml` 실행을 취소한다. 릴리스가 같은 검사와 빌드를 같은 커밋에서 하므로 잃는 검증은 없다. `preflight` job에만 `actions: write` 권한을 준다.

- 대상: 워크플로 파일이 `desktop-ci.yml`이고 `head_sha`가 릴리스 커밋과 같으며 상태가 대기 또는 실행 중인 실행. 이벤트 종류는 가리지 않는다. 다른 커밋의 실행은 건드리지 않는다.
- 버전·태그 검사를 통과한 **뒤에** 취소한다. preflight가 거절할 릴리스 때문에 main 실행을 죽이지 않는다.
- 취소 호출이 실패하면 경고만 남기고 릴리스를 계속한다. 실패해도 릴리스가 느려질 뿐 틀려지지는 않는다.

### `tools/dev.py` 변경

PR #117의 `tools/dev.py` 위에서 고친다.

- **`check`의 묶음.** `engine`을 더한다: `pytest tests/unit tests/integration`. 묶음을 여러 개 받을 수 있게 한다(`./dev check desktop engine`). 인자가 없으면 `desktop`, `engine`, `server` 전부(지금은 `desktop`, `server`). 인자 파서와 기존 `check` 테스트가 함께 바뀐다. `desktop` 묶음의 내용은 그대로 둔다. `desktop`에 든 단위 테스트 파일 5개는 두 묶음을 함께 돌릴 때 두 번 돈다. 감수한다.
- **`build`의 부분 실행.** `./dev build runtime`(런타임 빌드 + 검증), `./dev build installer`(패키징 + macOS 프리뷰 검증). 인자가 없으면 지금처럼 둘 다 순서대로.
- **재시도.** `desktop-ci.yml`과 프리뷰 릴리스에 있는 "3번까지, 5초 쉬고" 재시도를 `Step`의 속성으로 옮긴다. 대상은 지금과 같이 런타임 빌드와 패키징 두 단계다. 로컬에서도 같은 동작이 된다.
- **extra.** `./dev setup`은 `backend`와 `mcp-server`까지 설치한다(지금 데스크톱 CI는 설치하지 않는다). CI가 개발자와 같은 환경을 쓰도록 그대로 둔다. uv 캐시 키는 `uv.lock` 해시라 바뀌지 않는다. 늘어나는 시간은 재서 보고한다.
- **소요 시간.** `check`와 `build`가 끝에 단계별 소요 시간을 초 단위로 적는다. 묶어서 한 step이 된 검사의 내부 시간을 로그에서 읽기 위해서다.

`--release`(서명 빌드)는 넣지 않는다. 다음 작업이 정한다.

### 캐시

| 캐시 | 방법 | 키 |
|---|---|---|
| Python 패키지 | `setup-uv` 내장(지금과 같음) | `uv.lock` 해시 |
| npm | `setup-node` 내장(지금과 같음) | `package-lock.json` 해시 |
| 고정 자산 다운로드(`build/desktop-downloads`) | `actions/cache` 추가 | OS + `tools/desktop-assets.lock.json` 해시 |

main 푸시 실행이 생기므로 main 범위에 캐시가 쌓이고 모든 PR이 읽는다. Intel의 `cryptography` 소스 빌드는 `uv.lock`이 바뀐 뒤 첫 전체 실행에서만 일어난다. PR 검사에는 Intel이 없으므로 영향이 없다.

`./dev setup`은 자산 준비(Whisper 모델 145MB, Windows는 FFmpeg 80MB 추가)를 포함한다. 검사 job에는 필요 없는 단계지만 로컬과 같은 명령을 쓰기 위해 그대로 둔다. 다운로드 캐시가 있으면 내려받지 않고 해시만 확인한다.

### 테스트

`tests/desktop/test_dev_script.py`:

- `test_desktop_checks_are_the_commands_the_pull_request_workflow_runs`를 없애고, "데스크톱 워크플로 네 개가 `uv sync`·`pytest`·`ruff`·`mypy`·`npm test`를 직접 적지 않고 `./dev`를 부른다"는 테스트로 바꾼다. 서명 단계의 `npm run dist:*:release`와 `verify_macos_release.py`는 예외다.
- `test_server_checks_are_the_commands_the_mcp_workflow_runs`는 그대로 둔다(`mcp-ci.yml`은 안 바뀐다).
- `test_setup_installs_every_extra_a_workflow_installs`는 `mcp-ci.yml`의 extra가 `dev.EXTRAS`에 포함되는지로 바꾼다.
- 새 동작(묶음 여러 개, `engine`, `build` 부분 실행, 재시도 횟수와 대상, 소요 시간 출력)마다 단위 테스트를 더한다. 기존 테스트처럼 가짜 runner로 확인한다.

워크플로 자체는 실제 실행으로 확인한다(아래 "측정과 확인").

## 서명 단계가 들어갈 자리

다음 작업(서명·공증)이 손댈 곳은 `desktop-build.yml`의 `installers` job에서 `signed`일 때 도는 단계 한 묶음이다. 지금 `desktop-release.yml`의 단계를 글자 그대로 옮겨 둔다.

이 경로는 **이 작업에서 확인할 수 없다.** Apple 자격 증명이 없고 `Signed desktop release`는 한 번도 돈 적이 없다. 옮긴 뒤 원본과 줄 단위로 대조하는 것까지가 이 작업의 확인이다. 실제 동작 확인은 다음 작업이 한다.

공증은 Apple 서버 응답을 기다리므로 서명 릴리스는 프리뷰보다 오래 걸린다. 얼마나 걸리는지는 재 본 적이 없다.

## 예상 시간

**아래는 추정이다.** 위 표의 실측 단계 시간을 새 구조대로 더한 값이고, 범위는 빠른 실행~느린 실행이다. `./dev setup`이 더하는 자산 준비와 추가 extra, `engine` 묶음의 CI 소요 시간은 재 본 적이 없어 들어 있지 않다.

| 항목 | 지금 (실측) | 바꾼 뒤 (추정) |
|---|---|---|
| PR 검사 한 번 | 14~29분 | 5.5~8분 (Windows 검사 job이 정함) |
| PR 한 번의 macOS 러너 사용 | 27~36분 | 약 3~4분 |
| 릴리스 워크플로 | 20~27분 | 12.5~18분 (Intel 설치 파일 job이 정함) |
| 릴리스 PR 검사 + 릴리스 | 45분 (v0.2.2) | 18~26분 |

Intel 설치 파일 job의 추정 내역(캐시 있음): 준비 약 1분 + 런타임 빌드 208~296초 + 검증 22~27초 + 패키징 226~366초 + DMG·ZIP 검증 118~178초 + 업로드 47~57초.

## 측정과 확인

구현 PR에서 다음을 실제로 돌리고 `gh run view`(job·step 시간)와 로그의 단계별 소요 시간으로 표를 만든다.

1. **PR 범위.** 구현 PR 자체의 PR 검사. 다운로드 캐시가 없는 첫 실행과 있는 재실행을 따로 적는다.
2. **전체 범위.** 구현 브랜치에서 수동 실행(`gh workflow run "Desktop Windows and macOS" --ref <브랜치>`). 세 OS의 검사와 설치 파일. 마찬가지로 캐시 없음/있음을 구분한다.
3. **Windows에서 `./dev`.** 먼저 개발 문서에 적힌 그대로 `./dev setup`을 PowerShell에서 부른다. 이것이 `dev.cmd`의 첫 실제 실행이다. 통과하면 그대로 두고, PowerShell이 `dev.cmd`를 찾지 못하면 아래 "위험과 대비"의 대비로 간다.
4. **취소 동작.** 같은 PR에 연달아 푸시해 이전 실행이 취소되는지 본다.
5. **병합 뒤.** main 푸시 실행이 돌고 main 범위에 캐시가 저장되는지 본다.

확인할 수 없는 것:

- **릴리스 워크플로의 실제 시간.** 돌리면 릴리스가 게시되므로 다음 실제 릴리스 때 잰다. 그때까지는 2번(같은 공용 워크플로, preflight·publish 약 1분 제외)이 근거다. 릴리스 워크플로의 YAML은 문법 검사와 원본 대조로만 확인한다.
- **main 실행 취소 단계.** 릴리스 preflight에서만 돌기 때문에 같은 이유로 다음 릴리스 때 확인된다.
- **서명 경로.** 위 "서명 단계가 들어갈 자리" 참고.

## 위험과 대비

| 위험 | 대비 |
|---|---|
| PowerShell이 `./dev`를 확장자 없는 `dev` 파일로 해석해 실패한다. 저장소 루트에 `dev`와 `dev.cmd`가 함께 있다. | `./dev`로 먼저 시도한다. 실패할 때만 워크플로에서 Windows를 `.\dev.cmd`로 부르고, 문서의 Windows 명령이 틀렸다는 사실을 사용자와 개발 스크립트 쪽에 알린다. 문서 수정은 그쪽 결정이다. |
| `engine` 묶음이 Windows나 Intel에서 실패한다(돌려 본 적 없음). | 작은 수정이면 고친다. 아니면 그 OS에서는 `engine`을 빼고 이슈로 남긴 뒤 사용자에게 보고한다. 말없이 빼지 않는다. |
| Intel이나 패키징 문제가 병합 뒤에야 드러난다. | 사용자가 받아들인 대가다. main 실행이 빨갛게 보이고, 릴리스 워크플로는 실패하면 게시하지 않는다. 패키징을 건드리는 PR은 수동 전체 실행을 돌린다. |
| main 실행이 취소되면 그 실행은 캐시를 저장하지 못한다. | 다음에 끝까지 도는 main 실행이 저장한다. 릴리스 실행도 main 범위에 저장한다. |
| Windows pytest(229~345초)가 PR 검사의 하한이다. | 이 작업에서는 그대로 둔다. 성공 기준(10분)은 넘지 않는다. |
| 구현 중 #117이 아직 병합되지 않았다. | 사용자에게 묻는다. #117 브랜치 위에 쌓을 수 있지만 PR 대상과 순서는 사용자가 정한다. |

## 후속으로 남기는 것

- `mcp-ci.yml`도 `./dev check server`를 부르게 하기.
- blockmap 생성 생략(macOS에서 50~76초, 업로드 대상이 아님). `electron-builder` 설정을 바꿔야 해서 따로 확인이 필요하다.
- Windows pytest 병렬화.
- 고정 자산을 프로젝트 릴리스에 미러링하기.
- `./dev build --release`(서명 작업에서 결정).

## 구현자가 정할 것

- `desktop-build.yml`에서 OS 목록을 `full`에 따라 고르는 표현 방식(`fromJSON`, `exclude`, `if` 중 무엇이든).
- 릴리스 preflight에서 main 실행을 취소하는 구체적인 명령.
- `dev.py`에서 재시도와 소요 시간을 넣는 자리와 출력 형식.
- 문서 두 곳의 문장.

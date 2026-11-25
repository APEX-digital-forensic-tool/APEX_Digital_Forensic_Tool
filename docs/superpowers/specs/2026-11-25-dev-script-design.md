# 개발 설치·빌드 스크립트 — 설계

작성일: 2026-11-25 · 상태: 승인됨 (2026-11-25)

## 목적

저장소를 받은 개발자가 Windows와 macOS에서 **같은 명령**으로 개발 환경 설치, 앱 실행, 설치 파일 빌드, CI와 같은 검사를 하게 한다.

지금은 `docs/desktop/README.md`의 명령 다섯 개를 손으로 실행한다. 같은 내용이 여러 곳에 따로 적혀 있어 이미 어긋났다.

- `uv sync`의 extra 목록이 문서 3곳, 워크플로 3곳, `tools/build_desktop_runtime.ps1`에 각각 적혀 있다.
- PR 검사(`desktop-ci.yml`)는 `tests/unit/test_file_system_indexing.py`를 돌리지만 릴리스 워크플로 두 개의 테스트 목록에는 없다.

성공 기준:
- 새로 받은 저장소에서 `./dev setup` 다음 `./dev run`으로 앱이 뜨고 분석 엔진이 연결된다.
- `./dev build`가 CI와 같은 순서로 설치 파일을 만들고 검증까지 통과한다.
- extra 목록과 검사 목록이 `tools/dev.py` 한 곳에 있다.

## 목표와 범위

목표:
- 명령 다섯 개: `setup`, `run`, `build`, `check`, `doctor`.
- Windows x64, macOS arm64, macOS x64에서 같은 사용법.
- 다시 실행해도 안전하다. 이미 된 단계는 빠르게 지나간다.

하지 않는 것:
- **워크플로 수정.** CI가 이 스크립트를 부르게 바꾸는 일은 다음 작업(CI 단축)에서 한다. 그때까지 목록은 워크플로에도 남는다.
- 서명·공증 빌드(`dist:mac:release`). 서명 작업에서 다룬다.
- 인증 백엔드·MCP 서버 실행. 서버 배포 작업에서 다룬다.
- `tools/build_desktop_runtime.ps1`, `tools/run_gui_ai.ps1` 변경.
- Linux 지원. 막지는 않지만 확인하지 않는다.

피해야 할 결과:
- 개발자 컴퓨터의 Node나 uv를 묻지 않고 설치하거나 바꾸는 것.
- 검사 하나가 실패했을 때 나머지를 돌리지 않아 실패를 하나씩만 보게 되는 것.
- 스크립트의 검사 목록이 CI와 달라 "로컬에서는 통과, CI에서는 실패"가 되는 것.

## 제약

- 저장소 요구 사항은 그대로다: Python 3.12, Node.js 24, uv. Mac에서는 Python과 Node의 아키텍처가 같아야 한다.
- `uv sync`는 목록에 없는 패키지를 지운다. 그래서 `setup`은 데스크톱·서버·개발 도구를 **한 환경에 모두** 설치한다. 데스크톱 extra만 설치하면 서버 테스트용 패키지가 지워진다.
- 스크립트가 출력하는 글은 영어로 쓴다. 기존 `tools/` 도구가 영어로 출력하고, Windows 콘솔에서 한글이 깨지는 문제를 피한다. 문서는 한국어다.

## 검토한 방법

| 방법 | 장점 | 단점 |
|---|---|---|
| **A. Python 한 벌 + 얇은 실행 파일** (선택) | 로직이 한 곳. 기존 빌드 도구와 같은 구조. CI가 그대로 부를 수 있다. | uv가 먼저 있어야 한다. |
| B. Node 스크립트 (`npm run setup`) | 프런트 스크립트와 같은 언어. | Node가 Python 환경을 만드는 꼴. 루트에 `package.json`이 없다. |
| C. OS별 스크립트 두 벌 | 아무것도 없어도 돌아간다. | 같은 내용을 두 번 쓰고 어긋나기 쉽다. |

사용자가 A를 골랐다(2026-11-25). 이 저장소에서 반복되는 문제가 "같은 목록이 여러 곳에서 어긋남"이고, A만 그 목록을 한 곳으로 모은다.

## 설계

### 파일

| 파일 | 역할 |
|---|---|
| `tools/dev.py` | 모든 로직. 표준 라이브러리만 쓴다(환경이 없을 때도 돌아야 한다). |
| `dev` | macOS용 실행 파일(sh). uv가 있는지 보고 `tools/dev.py`에 인자를 넘긴다. |
| `dev.cmd` | Windows용 실행 파일. 같은 일을 한다. cmd와 PowerShell 모두에서 `.\dev`로 부른다. |
| `tests/desktop/test_dev_script.py` | 로직 단위 테스트. `tests/desktop`에 두어 기존 CI가 세 OS에서 돌린다. |
| `.gitattributes` | `dev`는 LF, `dev.cmd`는 CRLF로 고정한다. |

실행 파일은 프로젝트 환경을 건드리지 않고 `tools/dev.py`를 실행한다. uv가 없으면 설치 명령을 보여 주고 끝낸다.

### 명령

**`setup`** — 순서대로 실행하고, 실패하면 그 자리에서 멈춘다.
1. 도구 점검(아래). 문제가 있으면 아무것도 설치하지 않고 고치는 방법을 보여 준다.
2. `uv sync --locked --python 3.12`에 extra 열 개: `desktop`, `desktop-build`, `report-renderer`, `browser-media`, `windows-artifacts`, `machine-extraction`, `advanced-secrets`, `dev`, `backend`, `mcp-server`. Python 3.12가 없으면 uv가 받는다.
3. `tools/prepare_desktop_assets.py` — 음성 인식 모델을 체크섬과 함께 받는다.
4. `frontend/`에서 `npm ci`.
5. 다음에 칠 명령(`./dev run`)을 알려 준다.

**`run`** — `frontend/`에서 `npm run dev`. `.venv`나 `node_modules`가 없으면 실행하지 않고 `setup`을 안내한다.

**`build`** — CI와 같은 순서로 프리뷰 설치 파일을 만든다.
1. `tools/build_desktop_runtime.py`
2. `tools/verify_desktop_runtime.py`
3. `npm run dist:mac` 또는 `npm run dist:win`
4. Mac에서만 `tools/verify_macos_preview.py`
5. 만들어진 파일의 경로를 출력한다.

**`check [desktop|server]`** — CI가 돌리는 검사. 인자가 없으면 둘 다 돌린다.
- `desktop`: `desktop-ci.yml`의 pytest 목록, ruff 목록, `mypy --strict src/apex_desktop`, `npm test`.
- `server`: `mcp-ci.yml`의 `tests/mcp`, `tests/backend`, ruff, `mypy --strict src`, `verify_mcp_stdio.py`, `verify_engine_release.py --mcp-only`.
- 하나가 실패해도 나머지를 끝까지 돌리고, 마지막에 통과·실패를 한눈에 보여 준다. 하나라도 실패하면 종료 코드는 0이 아니다.
- 설치 파일 빌드와 MCP 패키지 검사(`clean-package`)는 포함하지 않는다.

**`doctor`** — 아무것도 바꾸지 않는다. 아래 항목의 상태와, 문제가 있는 항목의 고치는 명령을 보여 준다.

### 도구 점검

| 항목 | 기준 | 문제가 있을 때 |
|---|---|---|
| uv | 설치됨 | 설치 명령 안내 후 중단 |
| Node.js | 주 버전 24 | 설치 방법 안내 후 중단 |
| 아키텍처 (Mac) | Python과 Node가 같음 | 어느 쪽이 무엇인지 보여 주고 중단 |
| `.venv` | Python 3.12, lock과 일치 | `./dev setup` 안내 |
| `frontend/node_modules` | 있음 | `./dev setup` 안내 |
| `desktop-assets` | 있음 | `./dev setup` 안내 |
| `desktop-runtime` | 있으면 플랫폼·아키텍처 표시 | `build`에만 필요하므로 경고만 |

Python 3.12만 자동으로 받는다(uv가 자기 폴더에 받아 다른 것에 영향이 없다). uv와 Node는 스크립트가 설치하지 않는다. Node는 사람마다 관리 방식이 달라 스크립트가 바꾸면 다른 프로젝트가 깨질 수 있다.

### 문서

`docs/desktop/README.md`의 "개발 실행", "설치 파일 빌드", "검증" 절과 `frontend/README.md`의 명령 블록을 `./dev` 명령으로 바꾼다. 실제로 실행되는 명령은 `tools/dev.py`에 있다고 적는다.

## 확인 방법

- **단위 테스트:** 명령 실행기를 가짜로 바꿔 다음을 확인한다 — `setup`의 단계 순서와 extra 목록, 도구 점검 실패 시 아무것도 실행하지 않음, 아키텍처 불일치 감지, `check`가 실패 뒤에도 계속 돌고 0이 아닌 코드로 끝남, 준비가 안 됐을 때 `run`이 거절함.
- **이 Mac에서 실제로:** 임시 폴더에 저장소를 새로 받아 `doctor` → `setup` → `run`(창이 뜨고 엔진 연결) → `check` → `build`(DMG·ZIP 생성과 검증 통과)를 차례로 실행한다.
- **Windows:** 단위 테스트는 기존 CI의 Windows 러너에서 돈다. `dev.cmd`와 실제 `setup`·`build`는 이 작업에서 확인하지 못한다. 다음 작업에서 CI가 이 스크립트를 부르게 되면 그때 확인된다. 그 전까지 문서에 "Windows 실행 파일은 확인 전"이라고 적는다.

## 구현자가 정할 것

- lock이 바뀌지 않았을 때 `npm ci`를 건너뛰는 방법.
- 출력 모양(단계 표시, 요약 표).
- uv·Node 설치 안내에 넣을 정확한 명령.
- 실행 파일이 `tools/dev.py`를 부르는 정확한 uv 옵션.

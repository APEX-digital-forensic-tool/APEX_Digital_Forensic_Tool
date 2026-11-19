---
name: verify-apex
description: Drive the APEX desktop workbench (React UI in frontend/) against the real Python engine and real disk images, the way an analyst uses it, and capture proof. Use to prove a UI or engine change works, to reproduce a reported UI bug, or whenever "verified" is claimed for APEX. Mocked vitest runs are not proof.
---

# Verify APEX

APEX is an Electron app. Its renderer is the React build in `frontend/`, its engine is `python -m apex_desktop` (FastAPI on an OS-assigned loopback port), and Electron's preload bridge (`frontend/electron/preload.ts`) carries every call between them. This skill replaces only Electron: Vite serves the real renderer, `scripts/shim.js` stands in for the preload bridge, and a Vite proxy adds the engine's bearer token like Electron's main process. Every operation reaches the real engine. The one replaced boundary is the native file dialog.

Surfaces not covered here: the Electron shell itself (window, single-instance lock, engine spawn and quit, first-run setup window) and the packaged runtime. Prove those with `tools/verify_desktop_runtime.py`, `tools/verify_macos_preview.py`, or the installed app.

## Launch

From the repo root:

```bash
.claude/skills/verify-apex/scripts/apex-verify up
```

It creates a fresh run directory under `${APEX_VERIFY_HOME:-$TMPDIR/apex-verify}/<run-id>/` with `data/` (engine data dir), `corpus/`, `artifacts/` and `logs/`. It starts the engine on an empty data dir, waits for `apex-ready`, `/health` `ready:true` and a successful `cases.list`, then starts Vite on `127.0.0.1:5174` and waits until it serves the shim. It prints `ready`, the UI URL and the artifacts path. Set `APEX_VERIFY_UI_PORT` when 5174 is taken.

Requires `.venv` (`uv sync`) and `frontend/node_modules` (`npm --prefix frontend ci`).

Then put evidence in the run:

```bash
.claude/skills/verify-apex/scripts/apex-verify corpus
```

It decodes `tests/fixtures/container-images.json` (hash-checked) into `corpus/` and prints a JSON map of absolute paths: `compressed.E01`, `disk.vhd`, `disk.vhdx` (each holds `/문서.txt` = `E01 가상 디스크의 실제 내용`), `streams.img` (NTFS with ADS on `/document.txt`), `exfat-times.img`, `ocr.png` (`HELLO 123`), and `folder-evidence/` for folder intake. `tests/fixtures/CONTAINER_IMAGES.md` describes each image.

Open the UI in the Claude Code browser pane with `preview_start` `{url: "http://127.0.0.1:5174/"}`, then `resize_window` to 1440x900. The default pane is narrow enough to hide columns.

## Doctor

Run first, and again whenever anything looks off:

```bash
.claude/skills/verify-apex/scripts/apex-verify doctor
```

It checks that both processes this run started are alive, the engine is ready, the shim is served, and whether the checkout moved since `up`. Python changes need `down` and `up` to reach the engine. Frontend changes reload through Vite, but HMR is off, so reload the page.

## Drive

Use the browser pane tools (`find`, `read_page`, `computer` with `ref`, `form_input`, `javascript_tool`, `screenshot`). The UI is Korean by default. Handles that exist today:

- Top bar: `select[aria-label="현재 사건"]`, `select[aria-label="현재 증거"]`, buttons `새 사건`, `이미지 추가`, `폴더 추가`, `증거 관리`, `작업 N` (jobs drawer), `알림 닫기`.
- Route groups and tabs: `사건` → `사건 개요`, `증거 관리`, `증거 보관 이력`; `탐색` → `파일 시스템`, `아티팩트`, ...; `분석` → `타임라인`, ...; `보고서`.
- Main list: `#main-workspace table tbody tr`. Folder rows open on double-click. A row click selects and fills the inspector.
- Dialogs: `[role=dialog]`. Errors: `[role=alert]`.

File dialog: queue an absolute path, then click the add or pick button. The next `window.apex.pick` call returns it:

```js
window.__apexVerify.pick("<absolute path from apex-verify corpus>");
```

Set a React `select` with `form_input` on its ref. A plain `.value =` assignment does not reach React.

Read engine state for side-effect checks through the same bridge the UI uses: `await window.apex.invoke("evidence.list", { case_id })` in `javascript_tool`. Use it to confirm stored results, never to perform the step you are proving.

The feature map in `features/README.md` holds the recipes. Read it, then the feature file for the behavior you are proving.

## Evidence

- Save proof under the run's `artifacts/<feature-id>/`. Browser-pane screenshots land in the session's `tool-results/` folder; copy each one you cite into `artifacts/`.
- Capture the user action and the resulting state: the dialog or control before, and the screen after.
- Confirm side effects from a second view: the stored row through `window.apex.invoke`, a hash recomputed with `shasum -a 256`, or a file's bytes in the `Text` or `Hex` viewer.
- Drive the user path. Do not call operations directly in place of a click. The only allowed stand-in is `window.__apexVerify.pick` for the native dialog.
- Name the commit you verified (`apex-verify env` prints `GIT_REV`). A run on `main` does not prove a fix that lives on another branch.

## Cleanup

```bash
.claude/skills/verify-apex/scripts/apex-verify down
```

It stops the engine and Vite by the PIDs this run recorded (never by process name), deletes `data/` and `corpus/`, and keeps `artifacts/` and `logs/`. `down --purge` also deletes the run directory. Close the browser tab with `tabs_close` and reset the viewport with `resize_window` preset `desktop`.

## Gotchas

- The engine refuses evidence paths with a symlinked component, such as `/tmp` or `/var` on macOS. `apex-verify` resolves its paths; resolve any path you add yourself with `realpath`.
- The engine refuses evidence inside or above its own data directory.
- Task status is polled every 1.6 s. Wait for the state you need (a row, a status, a dialog), not a fixed sleep. A screenshot taken right after a click can miss a dialog that is already open, so check `[role=dialog]` first.
- `analysis.start` jobs on tiny fixtures can finish before the jobs drawer shows them. To exercise a running job, register a large sparse raw file (`mkfile -n 3g <path>.dd`) and hash it. Delete the file afterwards.
- One run owns one data dir. Never point a second engine at a run's `data/`, and never drive the user's installed APEX data.

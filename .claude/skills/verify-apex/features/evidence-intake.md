# Evidence intake

An analyst adds a disk image or a folder to the selected case, confirms it in the intake dialog, and gets a registered, read-only evidence item with the integrity hash they chose.

## Sub-features

- `intake-image` registers an E01, VHD, VHDX or raw image through `이미지 추가`.
- `intake-folder` registers a folder through `폴더 추가`.
- `intake-warning` shows a reader warning only when a reader the engine needs is unavailable.
- `intake-hash` starts the chosen hash after registration and stores the digest.

## How to get to it (user POV)

- Top bar `이미지 추가` or `폴더 추가`.
- `사건` → `증거 관리` → `이미지 추가` or `폴더 추가` inside the screen.

## Driving it with the browser pane

Preconditions:

- Baseline from the index, with a case selected and no evidence named `compressed.E01`.

- **Pick the image.** Run `window.__apexVerify.pick("<corpus>/compressed.E01")`, then click `이미지 추가`. Wait for `[role=dialog]` named `이미지 증거 등록`. It shows `compressed.E01` and the hash select defaults to `SHA-256 (권장)`.
- **Reader warning.** Read `[role=dialog] [role=alert]`. With the fix for issue #52 there is no alert for E01, VHD or VHDX. Before that fix, an alert names `e01-libewf`.
- **Register.** Click `증거 등록`. The dialog closes and the jobs drawer opens with `증거 등록` and `무결성 해시` jobs.
- **Confirm the stored result.** Click `증거 관리`. The row shows `compressed.E01`, `E01`, `준비됨` and a `SHA-256` digest. Run `window.apex.invoke("evidence.list", { case_id })` and `shasum -a 256 <corpus>/compressed.E01`. Both give the same digest.
- **Folder.** Run `window.__apexVerify.pick("<corpus>/folder-evidence")`, click `폴더 추가`, and register. The evidence row shows format `DIRECTORY`.
- **Proof.** Screenshot the open dialog and the evidence screen. Save them with the `shasum` output in `artifacts/evidence-intake/`.

## Gotchas

- A screenshot right after the click can miss the dialog. Check `[role=dialog]` first.
- Folder intake still offers SHA-256 by default, and the engine cannot hash a folder, so the hash job fails (issue #48). Report it; do not switch the hash to `지금은 계산하지 않음` to make the run pass.
- A `.001` raw image registers as a single file, not a disk (issue #63).

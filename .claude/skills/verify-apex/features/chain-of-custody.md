# Chain of custody

An analyst reviews the custody ledger of an evidence item, adds a custody event with a reason, and inspects or corrects a recorded event.

## Sub-features

- `custody-list` lists ledger events in order with type, action, actor, time and event hash.
- `custody-add` records an analyst event through `보관 이력 이벤트 추가`.
- `custody-inspect` shows the selected event in the inspector.
- `custody-correct` records a correction of a selected event.

## How to get to it (user POV)

- `사건` → `증거 보관 이력` with an evidence item selected in `현재 증거`.

## Driving it with the browser pane

Preconditions:

- An evidence item is registered and selected.

- **List.** Open `사건` → `증거 보관 이력`. The first row is `인수` / `Evidence registered` by `SYSTEM`, with an event hash.
- **Add.** Click `보관 이력 이벤트 추가`. In the dialog, choose `이벤트 유형`, fill `처리 내용` and `사유`, and click `이벤트 기록`. A new row appears after the registration row. Confirm it with `window.apex.invoke("custody.list", { case_id, evidence_id })`.
- **Inspect.** Click a row. The inspector shows the event fields.
- **Correct.** In the inspector, click `정정 기록 추가`, fill `정정 내용` and `정정 사유`, and click `정정 기록`. A correction event appears that names the original event.
- **Proof.** Screenshot the ledger before and after the added event, and the inspector. Save them in `artifacts/chain-of-custody/`.

## Gotchas

- Selecting any custody row fails with `작업을 완료하지 못했습니다. 오류 코드: DESKTOP_OPERATION_FAILED` until issue #53 is fixed, so `custody-inspect` and `custody-correct` fail today. Report both as failures with that alert.
- The API also accepts engine-only event types such as `HASH_VERIFIED` (issue #64). The dialog does not offer them; do not add them through `window.apex.invoke`.

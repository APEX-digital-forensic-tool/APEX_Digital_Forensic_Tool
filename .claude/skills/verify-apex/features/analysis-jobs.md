# Analysis jobs

An analyst starts analysis on evidence, follows it in the jobs drawer, can cancel it, and keeps their place on screen when a background job finishes.

## Sub-features

- `jobs-start` starts file, timeline, artifact or hash work from its screen.
- `jobs-drawer` lists running and finished jobs with progress and results.
- `jobs-cancel` cancels a running job, and a late cancel reports a conflict.
- `jobs-background` keeps the current page and selection when another job finishes.
- `jobs-errors` shows a failed action and a failed status poll without hiding the list.

## How to get to it (user POV)

- `분석 시작` on the file system screen, `타임라인 생성` on `분석` → `타임라인`, `해시 계산` and `무결성 재검증` in the evidence inspector on `증거 관리`.
- The top bar `작업 N` button opens the drawer. `작업 닫기` closes it.

## Driving it with the browser pane

Preconditions:

- An evidence item is indexed (see [File browsing](./file-browsing.md)).

- **Build a timeline.** Open `분석` → `타임라인` and click `타임라인 생성`. The drawer lists the job and the table fills with events.
- **Keep the page.** With more than 100 events, click `다음 결과`, then select a row. Start a hash on a different evidence item. When that job finishes, the table is still on page 2 and the inspector still shows the selected event (issue #55 fix).
- **Cancel late.** Register a 3 GiB sparse raw file, open the drawer, start its hash, wait until the engine reports it finished, then click the `작업 취소` button that is still shown. A `[role=alert]` reads `최신 상태와 요청이 충돌합니다.`, the list stays visible, and the alert stays on `사건 개요` until `알림 닫기` (issue #57 fix).
- **Proof.** Screenshot page 2 before and after the other job, and the conflict alert over the list. Save them in `artifacts/analysis-jobs/`.

## Gotchas

- Jobs on small fixtures finish before the drawer shows a cancel button. Use the large sparse file for cancel paths.
- Before the fixes for issues #55, #56 and #57, a finished job resets the page, one failed poll hides the list, and action errors disappear or block the list.
- A failed status poll cannot be produced without breaking the engine. To check it, wrap `window.apex.invoke` so that one `tasks.list` call returns `{ ok: false, error: { code: "STATE_CONFLICT" } }`, and say in the report that the failure was injected at the bridge.

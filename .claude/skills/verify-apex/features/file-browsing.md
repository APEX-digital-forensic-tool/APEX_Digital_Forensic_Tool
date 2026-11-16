# File browsing

An analyst indexes an evidence item, walks its folders in the evidence tree or the file list, selects a file, and reads its bytes in the content viewer without changing the source.

## Sub-features

- `browse-index` builds the file index with `분석 시작` on the file system screen.
- `browse-open` opens folders from the file list and the evidence tree.
- `browse-select` fills the property panel for the selected file.
- `browse-read` shows file bytes in the `Text` and `Hex` viewer tabs.

## How to get to it (user POV)

- `탐색` → `파일 시스템`.
- The evidence tree in the left panel.

## Driving it with the browser pane

Preconditions:

- `compressed.E01` is registered and selected in `현재 증거` (see [Evidence intake](./evidence-intake.md)).

- **Index.** Open `탐색` → `파일 시스템`. Leave `select[aria-label="분석 범위"]` at `전체 분석` and click `분석 시작`. The list shows `volume-0` once the job finishes.
- **Open a folder.** Double-click the `volume-0` row. The list shows `문서.txt` with size `37 B`.
- **Select a file.** Click the `문서.txt` row. The property panel shows its name and path.
- **Read bytes.** Click the `Text` tab in `내용 뷰어`. It shows `E01 가상 디스크의 실제 내용` and `Offset 0 · 37 bytes 반환 / 전체 37 bytes`. Click `Hex` for the same range as bytes.
- **Repeat for other containers.** `disk.vhd` and `disk.vhdx` give the same file and text.
- **Proof.** Screenshot the file list and the `Text` tab. Save them in `artifacts/file-browsing/`.

## Gotchas

- A single click on a folder row only selects it. Double-click opens it.
- Quick triage (`빠른 초기 분석`) leaves deep folders partial. Opening a partial folder starts a folder index job.
- The viewer reads at most 4 KiB per request. Use `다음 범위` for larger files.
- APFS images are not supported and show no file system.

# Project 1 bug fixes — 2026-11-17

This change starts from `d177140cc56f999b07649c11e1eb7a4d63ddb16a` (main,
including PR #71). It addresses the 19 bug issues below. Existing fixes from
PR #71 are retained. The separate skill additions in PR #72 are not included.

## Issue coverage

| Issue | Result |
| --- | --- |
| #48 | Directory intake defaults to no hash and offers only the supported option. |
| #49 | Terminal folder indexing tasks release their deduplication entry, allowing retry after failure or cancellation. |
| #50 | AI connection save/delete reports when settings were applied but restarting the engine failed. |
| #51 | The Files API validates its actual maximum page size of 500. Other page limits remain independent. |
| #53 | Custody events expose their case, event type and action to structured and raw views; cross-case access remains denied. Unsupported raw byte reads return a specific error. |
| #54 | A new report version uses the report-wide approval ledger revision, while its approval decision remains specific to that version. |
| #58 | Engine ownership uses an OS data-directory lock, parent EOF shutdown and a bounded force-stop fallback. Shutdown does not label noncancellable registration as cancelled. |
| #59 | Synchronous spawn errors, unwritable application data and startup/window load errors produce a visible failure state or native dialog. |
| #60 | Engine readiness has a timeout and retry; an exited child cannot restore a stale ready state. |
| #61 | External media/OCR/STT/conversion/capability processes receive an OS/tool environment allowlist rather than inherited provider credentials. |
| #62 | Search and timeline responses report missing, incomplete and stale per-evidence index coverage independently of the number of matching rows. |
| #63 | Partition images named `.001` enter filesystem discovery rather than loose-file handling. |
| #64 | Manual custody additions reject engine-only hash verification and correction event types. Corrections use the dedicated operation. |
| #65 | Directory carving is blocked before queueing. OCR validates actual image bytes before queueing. Empty alternate-stream results explain the NTFS requirement. |
| #66 | Editing search mode does not submit a previous query. History refreshes with the execution; changing scope clears stale rows/cursors. |
| #67 | Folder indexing state follows its actual task, folder metadata refreshes after indexing, interrupted tasks need attention, and automatic evidence selection synchronizes context. |
| #68 | Unexpected implementation exceptions remain server errors; review/correction input lengths are bounded; default report names receive the selected export extension. |
| #69 | File references are bounded and scoped by owner/purpose, invalid login URLs have a specific error, permissions are denied consistently, production CSP excludes the development socket, canonical evidence paths are queued, and the desktop AI timeout accommodates the provider maximum. |
| #73 | SQLite acquires its writer lock before reading the custody tail. Derived output publication rolls back on an audit exception, restoring overwritten output when necessary. |

Issue #70 (login/LLM provider development) has no description or acceptance
criteria. It remains open; the fixes above do not claim that new feature is
implemented.

## Reproducible checks

Use the locked Python development/desktop extras and the frontend lockfile.

```sh
python -m pytest
python -m pytest tests/desktop/test_project_backlog.py tests/desktop/test_engine_lifecycle.py
ruff check src/apex_desktop tests/desktop
mypy --strict src
npm --prefix frontend test
npm --prefix frontend run build
git diff --check
```

`test_project_backlog.py` runs its API regressions through both the in-process
ASGI application and a separate engine process over loopback TCP. It covers
the real filesystem fixture, report approval progression, custody views and
case boundaries, queue admission, forged custody types, index coverage and
page limits. Its additional SQLite concurrency check uses six independent
connections for 24 appends/exports and verifies the resulting chain and output
receipts. Fault injection checks removal of new output and restoration of an
overwritten output when its audit write fails.

The lifecycle regression launches real engines, verifies rejection of a
second owner without database modification, closes the parent pipe, and
verifies that a subsequent engine can acquire the released lock.

## Validation scope

Final local results with Python 3.12.2 and Node 24.22.3:

| Check | Result |
| --- | --- |
| Full Python suite | 932 passed, 17 skipped; 7 subtests passed |
| Frontend suite | 251 passed in 34 files |
| Frontend release policy checks | 15 passed; CSP check passed |
| Frontend production build | Passed contracts, TypeScript, Vite and Electron bundling |
| Ruff on changed Python files | Passed |
| Strict mypy on all source packages | Passed, 186 files |
| Supplemental source-engine HTTP checks | 72 passed |

The Python run cleared inherited application/provider and proxy configuration
and used offline model settings. Its executable search path excluded a broken
host FFmpeg installation; optional tool availability is reflected in the
skipped tests. No speech model was downloaded for this pass. Build output
includes the existing large-chunk advisory; it is not a build failure.

The checks use source-built services on macOS ARM64 and frontend component
tests. An additional source-engine HTTP verification passed 72 checks across
evidence intake, filesystem images, search, timeline, reports and transport
boundaries. This supplementary harness is local QA evidence; the committed
tests above provide the repeatable regression checks for these fixes.

Packaged Electron launch, installer signing/notarization, Windows execution
and Intel macOS execution were not tested in this pass. The Electron shell
and Python runtime must be rebuilt together because the shell now passes
`--parent-watch`. This change does not diagnose the previously reported native
installed-app launch failure.

The custody concurrency test is not an exhaustive 360-interleaving proof.
Output rollback handles audit exceptions; it does not provide a transaction
across SQLite and the filesystem under process kill or power loss.

Direct Project board access is unavailable because the current GitHub
authorization lacks `read:project`. Issue references can be closed by merging
the fix PR; this document does not indicate that the board, main branch or
published release was updated.

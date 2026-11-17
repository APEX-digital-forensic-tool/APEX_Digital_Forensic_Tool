---
name: verify-custody-ledger
description: Check every interleaving of concurrent chain-of-custody appends in APEX against the real engine code (CustodyLedger.add_event, the SQLite custody_events table, export audit). Use before merging any change to the custody ledger, the custody_events schema or repository methods, export or recovery audit, or anything that appends custody events from a new thread or process.
---

# Verify the custody ledger

The custody ledger is APEX's evidence-integrity record. Each evidence item has an append-only chain of events (`custody_events`), each linked by `previous_event_hash` and numbered by `immutable_revision`. Requests (`custody.add`) and the analysis worker can append to the same chain at the same moment, each on its own SQLite connection. A broken chain or an unrecorded export makes the evidence record unreliable in court.

`CustodyLedger.add_event` appends inside `SQLiteRepository.custody_append`, which opens `BEGIN IMMEDIATE`; inside it, `add_event` reads the chain's tail and inserts the next event with `save_custody_event`, which commits. Concurrent appends wait for SQLite's write lock instead of interleaving. Tests run one append at a time and never reach the window the lock closes.

## What is checked

`scripts/custody_interleavings.py` runs the real engine code, not a model. Each appender runs in a thread with its own `ServiceBundle`. A scheduler gates the two real steps of every append: opening the write transaction (entering `SQLiteRepository.custody_append`, after which the tail read `list_custody_events` runs) and the insert (`SQLiteRepository.save_custody_event`). It runs every ordering of those steps. A granted step still running after `BLOCK_WAIT` (0.2 s) is waiting for the write lock; the scheduler then grants the next step whose appender is ready, so each ordering runs as the nearest order the lock allows, and the trace says `... begin waits for the write lock`. Appenders are `custody.add`-style analyst events (`CustodyLedger.add_event`, as `operations.py` calls it) and `EvidenceImageService.export_range`. After each run it checks three properties against the stored ledger:

- `chain-intact`: the ledger always verifies. Revisions run 1..n and each event links to the one before it. A failure means a forked or broken chain.
- `no-silent-loss`: an append that returns has its event stored exactly once, and an append that raises stores nothing. A failure means the caller was told an event exists when it does not, or the reverse.
- `audited-export`: an exported file never exists without its `EXPORTED` custody event. A failure means derived evidence left the engine with no custody record.
- `appends-succeed`: every concurrent append returns. A failure means a caller got an error (a 500 through the desktop gateway) only because another append took the same revision.

Bounds: 2 or 3 concurrent appenders on one evidence item, every mix of appender kinds, every ordering of their read and insert steps (18 runs for 2, 360 for 3). One process, separate SQLite connections in WAL mode, as in the desktop engine.

Not covered: steps inside `add_event` other than the read and insert (hash computation and ID generation are local); more than 3 appenders; appenders in separate engine processes (same SQL behavior, but untested here); the hash-verification and recovery callers (see Coverage).

## Run it

```bash
.venv/bin/python .claude/skills/verify-custody-ledger/scripts/custody_interleavings.py
```

It takes a few seconds and needs only the repo's `.venv`. `--appenders 2` runs the smaller bound. It prints each property as `PASS` or `FAIL in N runs`, and for each failure the shortest counterexample as numbered steps. It exits 1 if any property fails.

Expected result at the sync commit: all four properties pass. A run takes about 2 minutes because overlapping orderings wait `BLOCK_WAIT`.

## Read a result

- A counterexample lists the real steps in order, such as `custody.add #0 reads the ledger tail: revision 1` and `export_range #1 insert of revision 2 fails: sqlite3.IntegrityError`, then the stored state that breaks the property.
- A new failure of `chain-intact` or `no-silent-loss` after your change is a real bug until shown otherwise. Do not weaken a property, the bounds or the scheduler to make it pass.
- A harness error (a `TimeoutError`, an appender that never reaches a gate) is a harness problem, not a finding. It usually means your change renamed or bypassed `custody_append` or `save_custody_event` on the append path. Update the gates in `run_appender` to wrap the new steps, then rerun.
- The check must be able to fail. After changing the harness, run all three mutants and confirm each one fails its property. Each mutant also drops the write lock, because while the lock spans the tail read and insert, appends never collide and the other safeguards are never reached:
  - `--mutant no-lock` skips `BEGIN IMMEDIATE`, which is the append before the fix for #73. `appends-succeed` must fail with `sqlite3.IntegrityError`.
  - `--mutant no-unique` also drops the `UNIQUE(evidence_id, immutable_revision)` constraint. `chain-intact` must fail with stored revisions like `[1, 2, 2]`.
  - `--mutant swallow-insert-error` also makes a failed insert look successful. `no-silent-loss` must fail.

## Known findings

Before the fix for #73 (commit `6e2116f`), the append had no lock across its tail read and insert. The losing insert raised `sqlite3.IntegrityError`, which the desktop gateway returns as 500 `DESKTOP_OPERATION_FAILED`, and exports published their file before `_audit_export`, so `audited-export` failed in 192 of 360 runs:

1. `custody.add #0` reads the ledger tail: revision 1.
2. `export_range #1` has written its file and reads the ledger tail: revision 1.
3. `custody.add #0` inserts revision 2.
4. `export_range #1` inserts revision 2 and fails with `sqlite3.IntegrityError`.
5. The exported file stays on disk with no `EXPORTED` event, and the caller gets an error.

The fix holds `BEGIN IMMEDIATE` across the tail read and insert, and `_publish_audited_output` deletes a new output, or restores the output an overwrite replaced, if its audit append still fails (for example `DATABASE_LOCKED` after `busy_timeout`). `--mutant no-lock` reproduces the old race; with it `audited-export` still passes because of that cleanup.

## Coverage and sync

Sync commit: `c945faa655100b9e32c55e61c337a5fdc3d98bb5` (`main`, merge of #74). The check was last confirmed to describe this code at that commit. Before you trust a result on a later commit, list changes to the covered code:

```bash
git diff c945faa655100b9e32c55e61c337a5fdc3d98bb5 -- src/apex_forensic/application/services/custody_ledger.py src/apex_forensic/adapters/persistence/sqlite/repository.py src/apex_forensic/application/services/evidence_image.py src/apex_forensic/application/services/evidence_manager.py src/apex_desktop/operations.py src/apex_desktop/app.py
```

Covered and driven:

- `src/apex_forensic/application/services/custody_ledger.py`: `CustodyLedger.add_event` (reads the tail and builds the event inside `custody_append`) and `verify_chain`.
- `src/apex_forensic/adapters/persistence/sqlite/repository.py`: `custody_events` schema with `UNIQUE(evidence_id, immutable_revision)`, `custody_append` (`BEGIN IMMEDIATE`, commit or rollback), `list_custody_events`, `save_custody_event`.
- `src/apex_forensic/application/services/evidence_image.py`: `export_range`, `_write_output`, `_publish_audited_output` and `_audit_export` (when the audit append fails, deletes a new output or puts back the output it replaced).

Covered by reading only, same pattern, not driven:

- `evidence_image.py`, `deleted_content.py`, `file_streams.py`, `carving.py`: `recover_deleted_file`, `export_file_slack`, NTFS stream export and carving publish through `_publish_audited_output` (or `_write_output`) with `_audit_export` as the audit, so they get the same cleanup.
- `evidence_manager.py`: hash verification appends `HASH_VERIFIED` through `_append_hash_verified_event` before saving the verification, so a lost race fails the job without an unaudited result. Registration appends `RECEIVED` for a new evidence item that no other appender can reach yet.
- `src/apex_desktop/operations.py` `custody.add` calls `add_event`. `src/apex_desktop/app.py` maps the non-`ApexError` `sqlite3.IntegrityError` to 500; `DATABASE_LOCKED` (`PersistenceError`) maps to 409.

When a change touches covered code: rerun the check. If the change is intended and the harness no longer matches the code (a renamed step, a new appender, a moved insert), update the harness and all three mutant runs first. Then move the sync commit to the new commit, and only after you confirm the harness drives the code as it now is.

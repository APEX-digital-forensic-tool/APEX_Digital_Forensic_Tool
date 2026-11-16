---
name: verify-custody-ledger
description: Check every interleaving of concurrent chain-of-custody appends in APEX against the real engine code (CustodyLedger.add_event, the SQLite custody_events table, export audit). Use before merging any change to the custody ledger, the custody_events schema or repository methods, export or recovery audit, or anything that appends custody events from a new thread or process.
---

# Verify the custody ledger

The custody ledger is APEX's evidence-integrity record. Each evidence item has an append-only chain of events (`custody_events`), each linked by `previous_event_hash` and numbered by `immutable_revision`. Requests (`custody.add`) and the analysis worker can append to the same chain at the same moment, each on its own SQLite connection. A broken chain or an unrecorded export makes the evidence record unreliable in court.

`CustodyLedger.add_event` appends in two separate steps: it reads the chain's tail, then inserts the next event. Concurrent appends can interleave between those steps. Tests run one append at a time and never reach that window.

## What is checked

`scripts/custody_interleavings.py` runs the real engine code, not a model. Each appender runs in a thread with its own `ServiceBundle`. A scheduler gates the two real steps of every append, the tail read (`SQLiteRepository.list_custody_events`) and the insert (`SQLiteRepository.save_custody_event`). It runs every ordering of those steps. Appenders are `custody.add`-style analyst events (`CustodyLedger.add_event`, as `operations.py` calls it) and `EvidenceImageService.export_range`. After each run it checks three properties against the stored ledger:

- `chain-intact`: the ledger always verifies. Revisions run 1..n and each event links to the one before it. A failure means a forked or broken chain.
- `no-silent-loss`: an append that returns has its event stored exactly once, and an append that raises stores nothing. A failure means the caller was told an event exists when it does not, or the reverse.
- `audited-export`: an exported file never exists without its `EXPORTED` custody event. A failure means derived evidence left the engine with no custody record.

Bounds: 2 or 3 concurrent appenders on one evidence item, every mix of appender kinds, every ordering of their read and insert steps (18 runs for 2, 360 for 3). One process, separate SQLite connections in WAL mode, as in the desktop engine.

Not covered: steps inside `add_event` other than the read and insert (hash computation and ID generation are local); more than 3 appenders; appenders in separate engine processes (same SQL behavior, but untested here); the hash-verification and recovery callers (see Coverage).

## Run it

```bash
.venv/bin/python .claude/skills/verify-custody-ledger/scripts/custody_interleavings.py
```

It takes a few seconds and needs only the repo's `.venv`. `--appenders 2` runs the smaller bound. It prints each property as `PASS` or `FAIL in N runs`, and for each failure the shortest counterexample as numbered steps. It exits 1 if any property fails.

Expected result at the sync commit: `chain-intact` and `no-silent-loss` pass, and `audited-export` fails (see Known findings).

## Read a result

- A counterexample lists the real steps in order, such as `custody.add #0 reads the ledger tail: revision 1` and `export_range #1 insert of revision 2 fails: sqlite3.IntegrityError`, then the stored state that breaks the property.
- A new failure of `chain-intact` or `no-silent-loss` after your change is a real bug until shown otherwise. Do not weaken a property, the bounds or the scheduler to make it pass.
- A harness error (a `TimeoutError`, an appender that never reaches a gate) is a harness problem, not a finding. It usually means your change renamed or bypassed `list_custody_events` or `save_custody_event` on the append path. Update the gates in `run_appender` to wrap the new read and insert steps, then rerun.
- The check must be able to fail. After changing the harness, run both mutants and confirm each one fails its property:
  - `--mutant no-unique` drops the `UNIQUE(evidence_id, immutable_revision)` constraint. `chain-intact` must fail with stored revisions like `[1, 2, 2]`.
  - `--mutant swallow-insert-error` makes a failed insert look successful. `no-silent-loss` must fail.

## Known findings

At the sync commit, `audited-export` fails. Shortest counterexample:

1. `custody.add #0` reads the ledger tail: revision 1.
2. `export_range #1` has written its file and reads the ledger tail: revision 1.
3. `custody.add #0` inserts revision 2.
4. `export_range #1` inserts revision 2 and fails with `sqlite3.IntegrityError`.
5. The exported file stays on disk with no `EXPORTED` event, and the caller gets an error.

`export_range`, `recover_deleted_file` and `export_file_slack` all publish the output before `_audit_export` appends its event. The losing insert raises `sqlite3.IntegrityError`, which is not an `ApexError`, so the desktop gateway returns 500 `DESKTOP_OPERATION_FAILED`. Nothing retries the append. A losing `custody.add` also returns that 500, though nothing is stored for it, so `no-silent-loss` holds.

The UNIQUE constraint is what keeps `chain-intact` true. The append itself has no lock or transaction across its read and insert.

## Coverage and sync

Sync commit: `6e2116f3eceb7133597d7c991deecfe2ba216750`. The check was last confirmed to describe this code at that commit. Before you trust a result on a later commit, list changes to the covered code:

```bash
git diff 6e2116f3eceb7133597d7c991deecfe2ba216750 -- src/apex_forensic/application/services/custody_ledger.py src/apex_forensic/adapters/persistence/sqlite/repository.py src/apex_forensic/application/services/evidence_image.py src/apex_forensic/application/services/evidence_manager.py src/apex_desktop/operations.py src/apex_desktop/app.py
```

Covered and driven:

- `src/apex_forensic/application/services/custody_ledger.py`: `CustodyLedger.add_event` (tail read at the `list_custody_events` call, insert at `save_custody_event`) and `verify_chain`.
- `src/apex_forensic/adapters/persistence/sqlite/repository.py`: `custody_events` schema with `UNIQUE(evidence_id, immutable_revision)`, `save_custody_event`, `list_custody_events`.
- `src/apex_forensic/application/services/evidence_image.py`: `export_range`, `_write_output`, `_audit_export`.

Covered by reading only, same pattern, not driven:

- `evidence_image.py`: `recover_deleted_file` and `export_file_slack` publish before `_audit_export`.
- `evidence_manager.py`: hash verification appends `HASH_VERIFIED` through `_append_hash_verified_event` before saving the verification, so a lost race fails the job without an unaudited result. Registration appends `RECEIVED` for a new evidence item that no other appender can reach yet.
- `src/apex_desktop/operations.py` `custody.add` calls `add_event`. `src/apex_desktop/app.py` maps the non-`ApexError` `sqlite3.IntegrityError` to 500.

When a change touches covered code: rerun the check. If the change is intended and the harness no longer matches the code (a renamed step, a new appender, a moved insert), update the harness and both mutant runs first. Then move the sync commit to the new commit, and only after you confirm the harness drives the code as it now is.

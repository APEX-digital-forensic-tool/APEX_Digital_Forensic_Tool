"""Exhaustively interleave concurrent custody appends through the real engine code.

Each appender runs in its own thread with its own ServiceBundle (one SQLite
connection each, like concurrent desktop requests and the task worker). The
scheduler gates the two real steps of a custody append: opening the write
transaction (SQLiteRepository.custody_append, BEGIN IMMEDIATE, followed by the
tail read) and inserting the new event (save_custody_event). It runs every
ordering of those steps. A granted step that is still running after
BLOCK_WAIT is waiting for SQLite's write lock; the scheduler then runs the next
step whose appender is ready, so the executed order is the nearest one the lock
allows. It then checks the properties below against the stored ledger.

Usage:
  custody_interleavings.py [--appenders N] [--mutant no-lock|no-unique|swallow-insert-error]

Exit code 0 when every property holds in every interleaving, 1 otherwise.
"""

from __future__ import annotations

import argparse
import itertools
import shutil
import sqlite3
import sys
import tempfile
import threading
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "src"))

from apex_forensic.config import build_services  # noqa: E402
from apex_forensic.domain.enums import CustodyEventType  # noqa: E402

PROPERTIES = {
    "chain-intact": (
        "The ledger always verifies: revisions run 1..n and each event links to the one before it."
    ),
    "no-silent-loss": (
        "An append that returns has its event stored exactly once; "
        "an append that raises stores nothing."
    ),
    "audited-export": "An exported file never exists without its EXPORTED custody event.",
    "appends-succeed": (
        "Every concurrent append returns; none fails because another got there first."
    ),
}
STEP_TIMEOUT = 15
BLOCK_WAIT = 0.2
# Every mutant also drops the write lock. While the lock spans the tail read and insert,
# appends never collide, so UNIQUE and the insert error path are never reached.
UNLOCKED = {"no-lock", "no-unique", "swallow-insert-error"}


class Scheduler:
    def __init__(self, labels: list[str]) -> None:
        size = len(labels)
        self.labels = labels
        self.cv = threading.Condition()
        self.waiting: dict[int, str] = {}
        self.released: set[int] = set()
        self.running: set[int] = set()
        self.finished = [False] * size
        self.log: list[str] = []

    def note(self, line: str) -> None:
        with self.cv:
            self.log.append(line)

    def run_step(self, index: int, step: str, operation):
        with self.cv:
            self.waiting[index] = step
            self.cv.notify_all()
            if not self.cv.wait_for(lambda: index in self.released, STEP_TIMEOUT):
                raise TimeoutError(f"appender {index} never got {step}")
            self.released.discard(index)
            del self.waiting[index]
            self.running.add(index)
        try:
            return operation()
        finally:
            with self.cv:
                self.running.discard(index)
                self.cv.notify_all()

    def finish(self, index: int) -> None:
        with self.cv:
            self.finished[index] = True
            self.cv.notify_all()

    def _settled(self) -> bool:
        return all(
            done or index in self.waiting or index in self.running
            for index, done in enumerate(self.finished)
        )

    def drive(self, order) -> None:
        remaining = list(order)
        with self.cv:
            while True:
                if not self.cv.wait_for(self._settled, STEP_TIMEOUT):
                    raise TimeoutError("an appender never reached a gate")
                remaining = [(i, s) for i, s in remaining if not self.finished[i]]
                if not remaining:
                    break
                ready = [
                    (i, s)
                    for i, s in remaining
                    if self.waiting.get(i) == s and i not in self.released
                ]
                if not ready:
                    if not self.running:
                        raise TimeoutError(f"no appender can take {remaining}")
                    self.cv.wait(STEP_TIMEOUT)
                    continue
                index, step = ready[0]
                remaining.remove((index, step))
                self.released.add(index)
                self.cv.notify_all()
                if not self.cv.wait_for(
                    lambda index=index: index not in self.released and index not in self.running,
                    BLOCK_WAIT,
                ):
                    self.log.append(f"{self.labels[index]} {step} waits for the write lock")
            if not self.cv.wait_for(lambda: all(self.finished), STEP_TIMEOUT):
                raise TimeoutError("an appender never finished")


@dataclass
class Outcome:
    kind: str
    label: str
    returned: bool = False
    error: str | None = None
    output_path: Path | None = None
    trace: list[str] = field(default_factory=list)


def make_template(base: Path, mutant: str | None) -> tuple[Path, str]:
    evidence_dir = base / "evidence"
    evidence_dir.mkdir()
    image = evidence_dir / "disk.dd"
    image.write_bytes(bytes(range(256)) * 256)
    database = base / "template.db"
    bundle = build_services(database)
    try:
        case = bundle.cases.create_case(name="custody interleavings", investigator="verifier")
        evidence = bundle.evidence.register_evidence(case_id=case.case_id, source_path=image)
    finally:
        bundle.close()
    if mutant == "no-unique":
        connection = sqlite3.connect(database)
        connection.executescript(
            """
            PRAGMA foreign_keys = OFF;
            PRAGMA legacy_alter_table = ON;
            ALTER TABLE custody_events RENAME TO custody_events_unique;
            CREATE TABLE custody_events (
                event_id TEXT PRIMARY KEY, case_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
                event_type TEXT NOT NULL, immutable_revision INTEGER NOT NULL,
                previous_event_hash TEXT, event_hash TEXT NOT NULL, occurred_at_utc TEXT NOT NULL,
                created_at TEXT NOT NULL, event_json TEXT NOT NULL
            );
            INSERT INTO custody_events SELECT * FROM custody_events_unique;
            DROP TABLE custody_events_unique;
            """
        )
        connection.commit()
        connection.close()
    return database, evidence.evidence_id


def run_appender(index, outcome, database, evidence_id, exports, scheduler, mutant):
    bundle = build_services(database, initialize=False)
    repository = bundle.repository
    real_append = repository.custody_append
    real_list = repository.list_custody_events
    real_insert = repository.save_custody_event

    @contextmanager
    def gated_append():
        with ExitStack() as transaction:
            if mutant in UNLOCKED:
                scheduler.run_step(index, "begin", lambda: None)
                scheduler.note(f"{outcome.label} starts its append without a write lock")
            else:
                scheduler.run_step(index, "begin", lambda: transaction.enter_context(real_append()))
                scheduler.note(f"{outcome.label} holds the write lock (BEGIN IMMEDIATE)")
            yield

    def traced_list(evidence: str):
        events = real_list(evidence)
        tail = events[-1].immutable_revision if events else 0
        scheduler.note(f"{outcome.label} reads the ledger tail: revision {tail}")
        return events

    def gated_insert(event):
        revision = event.to_schema_dict()["immutable_revision"]

        def insert():
            try:
                real_insert(event)
                scheduler.note(f"{outcome.label} inserts revision {revision}")
            except sqlite3.IntegrityError:
                scheduler.note(
                    f"{outcome.label} insert of revision {revision} fails: sqlite3.IntegrityError"
                )
                if mutant != "swallow-insert-error":
                    raise

        scheduler.run_step(index, "write", insert)

    repository.custody_append = gated_append
    repository.list_custody_events = traced_list
    repository.save_custody_event = gated_insert
    try:
        if outcome.kind == "export":
            result = bundle.images.export_range(
                evidence_id=evidence_id,
                offset=0,
                length=512,
                output_root=exports,
                filename=f"export-{index}.bin",
            )
            outcome.output_path = Path(result["output_path"])
        else:
            bundle.custody.add_event(
                evidence_id=evidence_id,
                event_type=CustodyEventType.ANALYZED,
                actor_name="analyst",
                action=f"note {index}",
                reason="interleaving check",
            )
        outcome.returned = True
    except Exception as error:  # the property checks judge every failure
        outcome.error = type(error).__name__
    finally:
        bundle.close()
        scheduler.finish(index)


def check(database, evidence_id, outcomes, exports) -> dict[str, str | None]:
    bundle = build_services(database, initialize=False)
    try:
        events = [e.to_schema_dict() for e in bundle.custody.list_events(evidence_id)]
        intact = bundle.custody.verify_chain(evidence_id)
    finally:
        bundle.close()
    failures: dict[str, str | None] = dict.fromkeys(PROPERTIES)
    if not intact:
        revisions = [e["immutable_revision"] for e in events]
        failures["chain-intact"] = f"verify_chain() is False; stored revisions {revisions}"
    for outcome in outcomes:
        if outcome.kind == "export":
            path = exports / f"export-{outcomes.index(outcome)}.bin"
            stored = [
                e
                for e in events
                if e["event_type"] == "EXPORTED"
                and e["destination_location"] == str(path.resolve())
            ]
        else:
            stored = [e for e in events if e["action"] == f"note {outcomes.index(outcome)}"]
        if outcome.returned and len(stored) != 1:
            failures["no-silent-loss"] = (
                f"{outcome.label} returned but {len(stored)} matching events are stored"
            )
        if not outcome.returned and stored:
            failures["no-silent-loss"] = (
                f"{outcome.label} raised {outcome.error} but its event is stored"
            )
        if not outcome.returned:
            failures["appends-succeed"] = f"{outcome.label} raised {outcome.error}"
        if outcome.kind == "export":
            path = exports / f"export-{outcomes.index(outcome)}.bin"
            if path.exists() and not stored:
                ending = "returned" if outcome.returned else f"raised {outcome.error}"
                failures["audited-export"] = (
                    f"{path.name} exists, {outcome.label} {ending}, and no EXPORTED event names it"
                )
    return failures


def schedules(size: int):
    steps = [(i, s) for i in range(size) for s in ("begin", "write")]
    for order in itertools.permutations(steps):
        if all(order.index((i, "begin")) < order.index((i, "write")) for i in range(size)):
            yield order


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--appenders", type=int, default=3, choices=(2, 3))
    parser.add_argument("--mutant", choices=("no-lock", "no-unique", "swallow-insert-error"))
    args = parser.parse_args()

    base = Path(tempfile.mkdtemp(prefix="custody-interleavings-")).resolve()
    try:
        template, evidence_id = make_template(base, args.mutant)
        kinds_sets = sorted(
            set(itertools.combinations_with_replacement(("analyst", "export"), args.appenders))
        )
        first_failure: dict[str, tuple[list[str], str]] = {}
        runs = 0
        failing_runs = dict.fromkeys(PROPERTIES, 0)
        for kinds in kinds_sets:
            for order in schedules(args.appenders):
                runs += 1
                run_dir = base / f"run-{runs}"
                run_dir.mkdir()
                database = run_dir / "apex.db"
                shutil.copy(template, database)
                exports = run_dir / "exports"
                outcomes = [
                    Outcome(kind, f"{'custody.add' if kind == 'analyst' else 'export_range'} #{i}")
                    for i, kind in enumerate(kinds)
                ]
                scheduler = Scheduler([outcome.label for outcome in outcomes])
                threads = [
                    threading.Thread(
                        target=run_appender,
                        args=(
                            i,
                            outcomes[i],
                            database,
                            evidence_id,
                            exports,
                            scheduler,
                            args.mutant,
                        ),
                    )
                    for i in range(args.appenders)
                ]
                for thread in threads:
                    thread.start()
                scheduler.drive(order)
                for thread in threads:
                    thread.join(STEP_TIMEOUT)
                trace = list(scheduler.log)
                for outcome in outcomes:
                    if outcome.error:
                        trace.append(f"{outcome.label} raises {outcome.error}")
                for name, failure in check(database, evidence_id, outcomes, exports).items():
                    if failure:
                        failing_runs[name] += 1
                        if name not in first_failure or len(trace) < len(first_failure[name][0]):
                            first_failure[name] = (trace, failure)
                shutil.rmtree(run_dir)
    finally:
        shutil.rmtree(base, ignore_errors=True)

    print(
        f"custody ledger interleavings: {runs} runs, {args.appenders} appenders, "
        f"mutant={args.mutant or 'none'}"
    )
    for name, statement in PROPERTIES.items():
        verdict = "PASS" if failing_runs[name] == 0 else f"FAIL in {failing_runs[name]} runs"
        print(f"\n[{verdict}] {name}: {statement}")
        if name in first_failure:
            trace, failure = first_failure[name]
            print("  shortest counterexample:")
            for number, line in enumerate(trace, 1):
                print(f"    {number}. {line}")
            print(f"  result: {failure}")
    return 0 if not any(failing_runs.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

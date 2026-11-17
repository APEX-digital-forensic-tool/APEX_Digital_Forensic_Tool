from __future__ import annotations

import threading
from pathlib import Path

from apex_forensic.config import build_services
from apex_forensic.domain.enums import CustodyEventType
from apex_forensic.domain.models import CustodyEvent
from apex_forensic.domain.services.canonical import canonical_sha256


def test_append_waits_for_a_concurrent_writer_and_links_after_it(
    tmp_path: Path, sample_file: Path
) -> None:
    database = tmp_path / "apex.db"
    setup = build_services(database)
    try:
        case = setup.cases.create_case(name="Concurrent custody")
        evidence = setup.evidence.register_evidence(case_id=case.case_id, source_path=sample_file)
    finally:
        setup.close()
    second = build_services(database, initialize=False)
    try:
        second.repository.connection.execute("BEGIN IMMEDIATE")
        tail = second.repository.list_custody_events(evidence.evidence_id)[-1]
        outcome: dict[str, object] = {}

        def append() -> None:
            first = build_services(database, initialize=False)
            try:
                outcome["event"] = first.custody.add_event(
                    evidence_id=evidence.evidence_id,
                    event_type=CustodyEventType.ANALYZED,
                    actor_name="analyst",
                    action="note while another writer appends",
                    reason="concurrency",
                )
            except Exception as error:  # the assertion below reports it
                outcome["error"] = error
            finally:
                first.close()

        appender = threading.Thread(target=append)
        appender.start()
        appender.join(0.5)
        concurrent = tail.to_schema_dict() | {
            "event_id": "concurrent-writer",
            "immutable_revision": tail.immutable_revision + 1,
            "previous_event_hash": tail.event_hash,
        }
        concurrent["event_hash"] = canonical_sha256(concurrent, exclude_keys={"event_hash"})
        second.repository.save_custody_event(CustodyEvent(concurrent))
        appender.join(10)

        assert "error" not in outcome, outcome.get("error")
        event = outcome["event"]
        assert isinstance(event, CustodyEvent)
        assert event.immutable_revision == tail.immutable_revision + 2
        assert event.to_schema_dict()["previous_event_hash"] == concurrent["event_hash"]
        assert second.custody.verify_chain(evidence.evidence_id)
    finally:
        second.close()

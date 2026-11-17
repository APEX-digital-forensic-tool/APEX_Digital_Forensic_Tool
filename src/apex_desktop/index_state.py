"""Per-evidence search and timeline index state, so "not checked" never reads as "no results"."""

from typing import Any

from apex_forensic.config import ServiceBundle

NONE, PARTIAL, CURRENT = "NONE", "PARTIAL", "CURRENT"
_SEARCH_SOURCES = ("FILE_SYSTEM_NODE", "WINDOWS_ARTIFACT")


def _search(connection: Any, case_id: str, evidence_id: str) -> dict[str, Any]:
    expected = connection.execute(
        "SELECT (SELECT COUNT(*) FROM fs_nodes WHERE case_id = ? AND evidence_id = ?)"
        " + (SELECT COUNT(*) FROM artifacts WHERE case_id = ? AND evidence_id = ?)",
        (case_id, evidence_id, case_id, evidence_id),
    ).fetchone()[0]
    indexed = connection.execute(
        "SELECT COUNT(DISTINCT source_type || ':' || source_id) FROM search_documents"
        " WHERE case_id = ? AND evidence_id = ? AND is_stale = 0 AND source_type IN (?, ?)",
        (case_id, evidence_id, *_SEARCH_SOURCES),
    ).fetchone()[0]
    state = NONE if indexed == 0 else PARTIAL if indexed < expected else CURRENT
    return {"state": state, "indexed_items": indexed, "source_items": expected}


def _timeline(connection: Any, case_id: str, evidence_id: str) -> dict[str, Any]:
    events = connection.execute(
        "SELECT COUNT(*) FROM timeline_events WHERE case_id = ? AND evidence_id = ?",
        (case_id, evidence_id),
    ).fetchone()[0]
    statuses = {
        row[0]
        for row in connection.execute(
            "SELECT status FROM timeline_jobs WHERE case_id = ?"
            " AND (evidence_id = ? OR evidence_id IS NULL)",
            (case_id, evidence_id),
        )
    }
    if "SUCCEEDED" in statuses:
        state = CURRENT
    elif statuses & {"PARTIAL", "PAUSED", "CANCELLED", "FAILED"} or events:
        state = PARTIAL
    else:
        state = NONE
    return {"state": state, "events": events}


def index_state(
    services: ServiceBundle, case_id: str, evidence_id: str | None = None
) -> list[dict[str, Any]]:
    connection = services.repository.connection
    rows = [
        e
        for e in services.evidence.list_evidence(case_id)
        if evidence_id is None or e.evidence_id == evidence_id
    ]
    return [
        {
            "evidence_id": e.evidence_id,
            "display_name": e.display_name,
            "search": _search(connection, case_id, e.evidence_id),
            "timeline": _timeline(connection, case_id, e.evidence_id),
        }
        for e in rows
    ]

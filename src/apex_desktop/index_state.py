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
    registered = connection.execute(
        "SELECT created_at FROM evidence WHERE evidence_id = ?", (evidence_id,)
    ).fetchone()[0]
    # A case-wide build only covers evidence that existed when it started.
    latest = connection.execute(
        "SELECT status, updated_at FROM timeline_jobs WHERE case_id = ?"
        " AND (evidence_id = ? OR (evidence_id IS NULL AND created_at >= ?))"
        " ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (case_id, evidence_id, registered),
    ).fetchone()
    if latest is None:
        return {"state": PARTIAL if events else NONE, "events": events, "stale": False}
    changed = connection.execute(
        "SELECT MAX(updated_at) FROM fs_nodes WHERE case_id = ? AND evidence_id = ?",
        (case_id, evidence_id),
    ).fetchone()[0]
    stale = latest[0] == "SUCCEEDED" and changed is not None and changed > latest[1]
    state = CURRENT if latest[0] == "SUCCEEDED" and not stale else PARTIAL
    return {"state": state, "events": events, "stale": stale}


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
